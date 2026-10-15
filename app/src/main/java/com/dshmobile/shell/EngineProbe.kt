package com.dsharnessmobile.shell

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * Probes the local dsh web engine from the shell side.
 * Seagull fork: engine port moved to 32080 (upstream uses 3080, which the
 * original dsh-mobile instance on the same device also binds — two engines
 * would fight for 3080). Kept in one constant so probe/start/URL all agree.
 *
 * 0.1.7 engine contract change (pitfall 69): the web host gates EVERY route
 * (index + /api/*) behind a per-process launch token that rotates on each
 * engine start. The token is only published in the engine.log banner
 * `dsh web: http://127.0.0.1:<port>/?token=<base64url>`. The shell therefore
 * parses the banner (bounded tail read, pitfall 64 family), exchanges the
 * token for the session cookie (GET /?token → 303 + Set-Cookie), and attaches
 * that cookie to every raw HTTP call; the WebView loads the authenticated URL
 * directly so its own cookie jar carries the session.
 */
object EngineProbe {

  const val ENGINE_PORT = 32080
  const val ENGINE_URL = "http://127.0.0.1:$ENGINE_PORT"

  /** Engine stdout log; set once by EngineManager during init. */
  @Volatile var logFile: java.io.File? = null

  @Volatile private var cachedToken: String? = null
  @Volatile private var cachedCookie: String? = null

  // Banner line: `dsh web: http://127.0.0.1:32080/?token=<base64url>` (LAN variants share the ?token= shape).
  private val TOKEN_LINE = Regex("""dsh web: https?://[^/\s]+/\?token=([A-Za-z0-9_-]+)""")

  /** Drop cached token/cookie (engine start/stop/restart; next probe re-reads the log). */
  fun invalidateSession() {
    cachedToken = null
    cachedCookie = null
  }

  /** Last launch token printed in the tail of the current engine.log generation. */
  fun launchToken(): String? {
    cachedToken?.let { return it }
    val f = logFile ?: return null
    return try {
      if (!f.exists()) return null
      val tail = java.io.RandomAccessFile(f, "r").use { raf ->
        val len = raf.length()
        val window = minOf(len, 512L * 1024L)
        raf.seek(len - window)
        val buf = ByteArray(window.toInt())
        raf.readFully(buf)
        String(buf, Charsets.UTF_8)
      }
      val token = TOKEN_LINE.findAll(tail).lastOrNull()?.groupValues?.get(1)
      if (token != null) cachedToken = token
      token
    } catch (_: Exception) {
      null
    }
  }

  /** Engine URL carrying the launch token (plain URL when the token is not out yet). */
  fun authenticatedUrl(base: String = ENGINE_URL): String {
    val t = launchToken() ?: return base
    return base + "/?token=" + t
  }

  /**
   * Session cookie for raw HTTP calls, obtained by the token → 303 exchange.
   * Returns the `Cookie:` header value or null when the engine is not reachable.
   */
  @Synchronized
  fun sessionCookie(force: Boolean = false): String? {
    if (!force) cachedCookie?.let { return it }
    val t = launchToken() ?: return null
    return try {
      val conn = URL(ENGINE_URL + "/?token=" + t).openConnection() as HttpURLConnection
      conn.instanceFollowRedirects = false
      conn.connectTimeout = 1500
      conn.readTimeout = 1500
      conn.requestMethod = "GET"
      conn.responseCode
      val value = conn.headerFields["Set-Cookie"]?.firstOrNull()?.substringBefore(';')
      conn.disconnect()
      if (value != null) cachedCookie = value
      value
    } catch (_: Exception) {
      null
    }
  }

  /**
   * Authenticated POST against the engine with one transparent re-auth on 401
   * (cookie expiry / token rotation after an engine restart).
   * @return HTTP code + body prefix; code -1 when the engine is unreachable.
   */
  fun post(path: String, body: String, contentType: String = "application/json", readTimeoutMs: Int = 5000): Pair<Int, String> {
    var code = -1
    var text = ""
    for (attempt in 0..1) {
      try {
        val conn = URL(ENGINE_URL + path).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 3000
        conn.readTimeout = readTimeoutMs
        conn.setRequestProperty("content-type", contentType)
        sessionCookie(force = attempt > 0)?.let { conn.setRequestProperty("Cookie", it) }
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        code = conn.responseCode
        text = runCatching {
          (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }?.take(200)
        }.getOrNull() ?: ""
        conn.disconnect()
        if (code != 401) return code to text
        cachedToken = null // engine restarted: re-read the banner on the retry
      } catch (_: Exception) {
        return -1 to ""
      }
    }
    return code to text
  }

  /**
   * One-shot reachability probe. Safe on any thread (never the main thread).
   * Running = the web host answers the authenticated index request
   * (303 token exchange or 200 with a live cookie). A 401 rotates the cached
   * token (engine restarted since the banner was parsed).
   * @param timeoutMs connect+read budget per attempt.
   * @return JSON: {running: Boolean, latencyMs: Int, error?: String}
   */
  fun check(timeoutMs: Int = 800): JSONObject {
    val token = launchToken()
      ?: return JSONObject().put("running", false).put("error", "no launch token in engine.log yet")
    return try {
      val conn = URL(ENGINE_URL + "/?token=" + token).openConnection() as HttpURLConnection
      conn.instanceFollowRedirects = false
      conn.connectTimeout = timeoutMs
      conn.readTimeout = timeoutMs
      val start = System.currentTimeMillis()
      val code = conn.responseCode
      conn.disconnect()
      if (code == 401) invalidateSession()
      JSONObject()
        .put("running", code == 303 || code == 200)
        .put("latencyMs", System.currentTimeMillis() - start)
    } catch (e: Exception) {
      JSONObject().put("running", false).put("error", e.message ?: "unknown")
    }
  }
}
