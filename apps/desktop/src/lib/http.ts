function withJsonHeaders(init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  };
}

async function getFailureMessage(response: Response) {
  const errorBody = await response.text();
  return errorBody || `Backend request failed: ${response.status}`;
}

export async function fetchJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, withJsonHeaders(init));

  if (!response.ok) {
    throw new Error(await getFailureMessage(response));
  }

  return (await response.json()) as T;
}

export async function fetchResponse(path: string, init?: RequestInit) {
  const response = await fetch(path, init);

  if (!response.ok) {
    throw new Error(await getFailureMessage(response));
  }

  return response;
}
