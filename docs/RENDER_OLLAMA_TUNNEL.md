# Connecting Render Deployment to Local Ollama via Secure Cloudflare Tunnel

This guide explains how to securely connect your deployed StepOut application on Render to your local Windows machine running Ollama and `gemma3:latest`.

---

## 1. Security Architecture

Exposing Ollama (`http://127.0.0.1:11434`) directly to the public internet via a tunnel without authentication is unsafe because anyone with the URL could spam your GPU/CPU or modify models.

StepOut uses a defense-in-depth architecture:

```
[Render Web Service]
       │
       ▼ (HTTPS with Authorization: Bearer <SECRET_TOKEN>)
[Cloudflare Tunnel (*.trycloudflare.com)]
       │
       ▼
[Local Authenticated Proxy on 127.0.0.1:11435]
       │ (1. Checks Bearer Token using timingSafeEqual)
       │ (2. Enforces whitelist: POST /api/chat, GET /api/tags, GET /api/version)
       │ (3. Rejects unauthorized / unlisted endpoints with 401 / 403)
       ▼
[Ollama on 127.0.0.1:11434] (gemma3:latest)
```

- **Authentication:** All requests must include `Authorization: Bearer <SECRET_TOKEN>`. Missing or invalid tokens return `401 Unauthorized`.
- **Endpoint Policy:** Strictly restricted to `POST /api/chat`, `GET /api/tags`, and `GET /api/version`. Dangerous admin endpoints (such as `POST /api/pull` or `DELETE /api/delete`) are completely blocked (`403 Forbidden`).
- **Local Isolation:** The proxy listens strictly on `127.0.0.1` (never `0.0.0.0`). Only local tools like `cloudflared` can reach it.
- **Privacy:** Secret tokens are never logged.

---

## 2. Step-by-Step Setup

### Step 1: Ensure Ollama is Running
Verify your local Ollama instance and the `gemma3:latest` model:
```powershell
ollama list
```
You should see `gemma3:latest` in the output.

---

### Step 2: Generate a Strong Secret Token
Generate a cryptographically secure 64-character hex token in PowerShell:

```powershell
$token = node -e "console.log(crypto.randomBytes(32).toString('hex'))"
Write-Host "Generated Secret Token: $token"
```

Save this token—you will supply it to both the proxy and your Render environment variables.

---

### Step 3: Start the Authenticated Local Proxy
In your first terminal, run:

```powershell
$env:OLLAMA_PROXY_TOKEN = $token
npm run proxy:ollama
```

You will see:
```
================================================================================
  StepOut Authenticated Ollama Proxy Running
================================================================================
  Local Address     : http://127.0.0.1:11435
  Forwarding Target : http://127.0.0.1:11434
  Authentication    : Bearer Token REQUIRED on all requests
================================================================================
[Proxy] Listening for requests...
```

---

### Step 4: Start the Cloudflare Tunnel
Open a **second PowerShell terminal** and start `cloudflared` pointing to the **proxy port (11435)**—**NOT** directly to Ollama:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:11435
```

In the output, Cloudflare will display a temporary public URL, for example:
```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at:                                         |
|  https://random-subdomain-1234.trycloudflare.com                                          |
+--------------------------------------------------------------------------------------------+
```

Copy your HTTPS tunnel URL (e.g. `https://random-subdomain-1234.trycloudflare.com`).

---

### Step 5: Configure Render Environment Variables
Log in to your [Render Dashboard](https://dashboard.render.com), navigate to your **StepOut Web Service**, and open the **Environment** tab.

Add or update the following variables:

| Variable | Value | Notes |
| :--- | :--- | :--- |
| `OLLAMA_BASE_URL` | `https://random-subdomain-1234.trycloudflare.com` | Your Cloudflare tunnel URL |
| `OLLAMA_API_KEY` | `<your-generated-token>` | The exact token from Step 2 |
| `OLLAMA_MODEL` | `gemma3:latest` | Gemma model identifier |
| `OLLAMA_TIMEOUT_MS` | `90000` | 90-second timeout for cloud-to-laptop inference |

Click **Save Changes**. Render will automatically restart your service with the new settings.

---

### Step 6: Quick Verification

#### 1. Verify that unauthorized requests are rejected:
In PowerShell:
```powershell
curl.exe -i https://random-subdomain-1234.trycloudflare.com/api/tags
```
Output will return `HTTP/1.1 401 Unauthorized`.

#### 2. Verify that authorized requests succeed:
```powershell
curl.exe -i -H "Authorization: Bearer $token" https://random-subdomain-1234.trycloudflare.com/api/tags
```
Output will return `HTTP/1.1 200 OK` with your installed models (`gemma3:latest`).

#### 3. Verify blocked endpoints are rejected:
```powershell
curl.exe -i -X POST -H "Authorization: Bearer $token" https://random-subdomain-1234.trycloudflare.com/api/pull
```
Output will return `HTTP/1.1 403 Forbidden`.

---

## 3. Stopping the Connection
When you are done testing or demonstrating:
1. Press `Ctrl + C` in the Cloudflare tunnel terminal.
2. Press `Ctrl + C` in the proxy terminal.
3. Your local laptop is immediately disconnected from the public internet.
