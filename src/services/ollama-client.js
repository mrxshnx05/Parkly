'use strict';

const { cleanText, isPlainObject } = require('./utils');

class OllamaClientError extends Error {
  constructor(message, { code = 'OLLAMA_ERROR', cause, status } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OllamaClientError';
    this.code = code;
    this.status = status;
  }
}

class OllamaUnavailableError extends OllamaClientError {
  constructor(message = 'The local Ollama service is unavailable', options = {}) {
    super(message, { ...options, code: 'OLLAMA_UNAVAILABLE' });
    this.name = 'OllamaUnavailableError';
  }
}

class OllamaResponseError extends OllamaClientError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'OLLAMA_INVALID_RESPONSE' });
    this.name = 'OllamaResponseError';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeOllamaBaseUrl(baseUrl, { allowRemote = false } = {}) {
  let url;
  try {
    url = new URL(baseUrl || 'http://127.0.0.1:11434');
  } catch (error) {
    throw new OllamaClientError('OLLAMA_HOST must be a valid HTTP URL', {
      code: 'OLLAMA_INVALID_CONFIGURATION',
      cause: error,
    });
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new OllamaClientError('OLLAMA_HOST must be an unauthenticated HTTP(S) URL', {
      code: 'OLLAMA_INVALID_CONFIGURATION',
    });
  }

  if (!allowRemote && !LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new OllamaClientError(
      'Remote Ollama hosts are disabled. Set allowRemote only after an SSRF and network-access review.',
      { code: 'OLLAMA_REMOTE_HOST_BLOCKED' },
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function extractJsonObject(content, maximumLength = 32_000) {
  if (isPlainObject(content) || Array.isArray(content)) {
    return content;
  }
  if (typeof content !== 'string') {
    throw new OllamaResponseError('Ollama did not return JSON content');
  }

  const text = content.trim();
  if (!text || text.length > maximumLength) {
    throw new OllamaResponseError('Ollama response is empty or exceeds the allowed size');
  }

  try {
    return JSON.parse(text);
  } catch {
    // Some models still wrap JSON in a Markdown code fence despite `format`.
    // Extract the first balanced object/array without evaluating any content.
    const start = text.search(/[\[{]/);
    if (start === -1) {
      throw new OllamaResponseError('Ollama response does not contain JSON');
    }

    const stack = [];
    let inString = false;
    let escaping = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaping) {
          escaping = false;
        } else if (character === '\\') {
          escaping = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === '{' || character === '[') {
        stack.push(character);
      } else if (character === '}' || character === ']') {
        const opening = stack.pop();
        if ((character === '}' && opening !== '{') || (character === ']' && opening !== '[')) {
          break;
        }
        if (stack.length === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new OllamaResponseError('Ollama response contains invalid JSON');
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 8) {
    throw new OllamaClientError('messages must contain between 1 and 8 messages', {
      code: 'OLLAMA_INVALID_REQUEST',
    });
  }

  return messages.map((message) => {
    if (!isPlainObject(message) || !['system', 'user', 'assistant'].includes(message.role)) {
      throw new OllamaClientError('Each Ollama message needs a valid role', { code: 'OLLAMA_INVALID_REQUEST' });
    }
    const content = cleanText(message.content, 8_000);
    if (!content) {
      throw new OllamaClientError('Ollama message content cannot be empty', { code: 'OLLAMA_INVALID_REQUEST' });
    }
    return { role: message.role, content };
  });
}

/**
 * Minimal Ollama HTTP client. It never sends an API key or authorization
 * header, defaults to a loopback-only endpoint, and uses native Node fetch.
 */
class OllamaClient {
  constructor({
    baseUrl = process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model = process.env.OLLAMA_MODEL || 'llama3.2:3b',
    timeoutMs = 6_000,
    allowRemote = false,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (typeof model !== 'string' || !model.trim() || model.length > 160) {
      throw new OllamaClientError('OLLAMA_MODEL must be a non-empty model name', {
        code: 'OLLAMA_INVALID_CONFIGURATION',
      });
    }
    if (typeof fetchImpl !== 'function') {
      throw new OllamaClientError('Native fetch is required to use Ollama', {
        code: 'OLLAMA_FETCH_UNAVAILABLE',
      });
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120_000) {
      throw new OllamaClientError('timeoutMs must be an integer between 250 and 120000', {
        code: 'OLLAMA_INVALID_CONFIGURATION',
      });
    }

    this.baseUrl = normalizeOllamaBaseUrl(baseUrl, { allowRemote });
    this.model = model.trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async isAvailable() {
    try {
      const body = await this._request('/api/tags', { method: 'GET' });
      return {
        available: true,
        models: Array.isArray(body.models)
          ? body.models.map((item) => (typeof item?.name === 'string' ? item.name : '')).filter(Boolean)
          : [],
      };
    } catch (error) {
      return {
        available: false,
        reason: error instanceof OllamaClientError ? error.code : 'OLLAMA_UNAVAILABLE',
      };
    }
  }

  async chatJson({ messages, model = this.model, temperature = 0, maxTokens = 300 } = {}) {
    if (typeof model !== 'string' || !model.trim() || model.length > 160) {
      throw new OllamaClientError('model must be a non-empty model name', { code: 'OLLAMA_INVALID_REQUEST' });
    }
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
      throw new OllamaClientError('temperature must be between 0 and 1', { code: 'OLLAMA_INVALID_REQUEST' });
    }
    if (!Number.isInteger(maxTokens) || maxTokens < 32 || maxTokens > 4_096) {
      throw new OllamaClientError('maxTokens must be between 32 and 4096', { code: 'OLLAMA_INVALID_REQUEST' });
    }

    const body = await this._request('/api/chat', {
      method: 'POST',
      body: {
        model: model.trim(),
        stream: false,
        format: 'json',
        messages: normalizeMessages(messages),
        options: {
          temperature,
          num_predict: maxTokens,
        },
      },
    });

    const content = body?.message?.content;
    return {
      value: extractJsonObject(content),
      model: typeof body?.model === 'string' ? body.model : model.trim(),
      doneReason: typeof body?.done_reason === 'string' ? body.done_reason : null,
    };
  }

  async _request(path, { method, body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      if (!response || typeof response.ok !== 'boolean') {
        throw new OllamaUnavailableError('Ollama returned an invalid HTTP response');
      }

      const raw = await this._readResponseText(response);
      if (!response.ok) {
        throw new OllamaClientError('Ollama returned an HTTP error', {
          code: 'OLLAMA_HTTP_ERROR',
          status: Number.isInteger(response.status) ? response.status : undefined,
        });
      }

      try {
        return JSON.parse(raw);
      } catch (error) {
        throw new OllamaResponseError('Ollama returned malformed JSON', { cause: error });
      }
    } catch (error) {
      if (error instanceof OllamaClientError) throw error;
      if (controller.signal.aborted) {
        throw new OllamaUnavailableError('Ollama request timed out', { cause: error });
      }
      throw new OllamaUnavailableError('Unable to reach the local Ollama service', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async _readResponseText(response) {
    let raw;
    if (typeof response.text === 'function') {
      raw = await response.text();
    } else if (typeof response.json === 'function') {
      raw = JSON.stringify(await response.json());
    } else {
      throw new OllamaResponseError('Ollama response body is unreadable');
    }

    if (typeof raw !== 'string' || raw.length > 1_000_000) {
      throw new OllamaResponseError('Ollama response exceeds the allowed size');
    }
    return raw;
  }
}

module.exports = {
  extractJsonObject,
  normalizeOllamaBaseUrl,
  OllamaClient,
  OllamaClientError,
  OllamaResponseError,
  OllamaUnavailableError,
};
