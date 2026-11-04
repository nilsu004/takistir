export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Takistir-Request': '1',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(
      'Cannot reach the API. Start both services with npm run dev.',
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result)
    throw new Error(
      result?.error || 'The API returned an unexpected response.',
    );
  return result;
}
