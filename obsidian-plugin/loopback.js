const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function localBase(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:'
    || !ALLOWED_HOSTS.has(url.hostname)
    || url.username
    || url.password
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash
  ) {
    throw new Error('Voice Memory 仅允许连接本机 loopback 服务。');
  }
  return url.href.replace(/\/$/, '');
}

module.exports = { localBase };
