const IS_DEV = Boolean(import.meta?.env?.DEV);
const RAW_API_BASE_URL = import.meta?.env?.VITE_API_BASE_URL?.trim();
const RAW_WS_BASE_URL = import.meta?.env?.VITE_WS_BASE_URL?.trim();

// Backend production host is Render; Vercel FE should call this backend when env is not provided.
const DEFAULT_API_BASE_URL = "https://love-app-igja.onrender.com";
const DEFAULT_WS_BASE_URL = "wss://love-app-igja.onrender.com";

export const BASE_URL = IS_DEV ? "" : RAW_API_BASE_URL || DEFAULT_API_BASE_URL;

const req = (method, path, body, isForm = false) => {
  const url = `${BASE_URL}${path}`;
  const opts = { method, credentials: "include" };
  if (body && !isForm) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  } else if (body && isForm) {
    opts.body = body;
  }

  if (IS_DEV) {
    console.info("[api:req]", {
      method,
      path,
      contentType: isForm ? "multipart/form-data" : "application/json",
    });
  }

  return fetch(url, opts).then(async (r) => {
    if (r.status === 204) return null;
    const data = await r.json().catch(() => ({}));

    if (IS_DEV) {
      console.info("[api:res]", {
        method,
        path,
        status: r.status,
        body: data,
      });
    }

    if (!r.ok) {
      let errorMsg = "Lỗi không xác định";

      if (typeof data === "object" && data !== null) {
        errorMsg = data.detail || data.message || JSON.stringify(data);
      } else if (typeof data === "string") {
        errorMsg = data;
      }

      if (IS_DEV) {
        console.error("[api:error]", {
          method,
          path,
          status: r.status,
          errorMsg,
          fullData: data,
        });
      }

      const err = new Error(errorMsg);
      err.status = r.status;
      err.body = data;
      err.path = path;
      throw err;
    }
    return data;
  });
};

export const api = {
  get: (path) => req("GET", path),
  post: (path, body) => req("POST", path, body),
  patch: (path, body) => req("PATCH", path, body),
  delete: (path) => req("DELETE", path),
  postForm: (path, formData) => req("POST", path, formData, true),
};

const deriveWsBase = () => {
  if (IS_DEV) return "ws://localhost:8000";
  if (RAW_WS_BASE_URL) return RAW_WS_BASE_URL;
  try {
    if (typeof window !== "undefined") {
      // When FE is deployed separately from backend, use the Render host directly.
      return DEFAULT_WS_BASE_URL;
    }
  } catch (e) {
    // ignore
  }
  return DEFAULT_WS_BASE_URL;
};

export const WS_BASE = deriveWsBase();
