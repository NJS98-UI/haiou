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
 * (index and all api endpoints) behind a per-process launch token that
 * rotates on each engine start. The token is only published in the engine.log
 * banner `dsh web: http://127.0.0.1:<port>/?token=<base64url>`. The shell
 * parses the banner (bounded tail read, pitfall 64 family), exchanges the
 * token for the session cookie (GET with token returns 303 + Set-Cookie), and
 * attaches that cookie to every raw HTTP call; the WebView loads the
 * authenticated URL directly so its own cookie jar carries the session.
 */
object EngineProbe {

  const val ENGINE_PORT = 32080
  const val ENGINE_URL = "http://127.0.0.1:$ENGINE_PORT"

  /** Engine stdout log; set once by EngineManager during init. */
  @Volatile var logFile: java.io.File? = null

  @Volatile private var cachedToken: String? = null
  @Volatile private var cachedCookie: String? = null

  /**
   * 最近一次从 banner 真读到的票（**不随 invalidateSession 清空**）：只用来判定「换代」，
   * 不参与任何请求构造，所以它不会把旧票喂给引擎。
   */
  @Volatile private var lastSeenToken: String? = null

  /**
   * 引擎会话代次（坑 82）：每当 banner 里出现一张**与上一代不同**的新票就 +1。
   *
   * 为什么界面侧需要它：0.1.7 引擎全路由鉴权（坑 69），WebView 的会话靠 `?token=` 那一次
   * 303 交换拿到的 cookie。看门狗自愈、坑 78 存储自愈、EngineRepair 阶梯、崩溃重启都会
   * **在界面毫无察觉的情况下把引擎换代**——旧 cookie 当场失效，页面每个请求都 401：
   * 用户看到的就是「页面在、没有临时工作区、发消息没回复」，而壳侧 `check()` 自己会重新
   * 取票、照样报 running=true，于是既不提示也不重载，永远卡死在这一态（重进 App 才临时好）。
   * 界面侧比对代次即可确定性地知道「手里那份会话已经过期」，见
   * `MainActivity.navigatedSessionGeneration`。
   */
  @Volatile var sessionGeneration: Long = 0L
    private set

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
      if (token != null) {
        // 换代判定（坑 82）：读到一张与上一代不同的票 = 引擎重启过，界面上的会话已失效。
        val previous = lastSeenToken
        if (previous != null && previous != token) {
          sessionGeneration++
          cachedCookie = null
        }
        lastSeenToken = token
        cachedToken = token
      }
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
   * Authenticated GET against the engine with one transparent re-auth on 401.
   * 坑 79：探活要看「插件树内部」而不只是 HTTP——引擎自己注册的路由在插件没激活时
   * 返回 404（not found），这正是「HTTP 健康但引擎死在里面」的确定性信号。
   * @return HTTP code + body prefix; code -1 when the engine is unreachable.
   */
  @Synchronized
  fun get(path: String, timeoutMs: Int = 2000): Pair<Int, String> {
    for (attempt in 0..1) {
      try {
        val conn = URL(ENGINE_URL + path).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        conn.instanceFollowRedirects = false
        sessionCookie(force = attempt > 0)?.let { conn.setRequestProperty("Cookie", it) }
        val code = conn.responseCode
        val text = runCatching {
          (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }?.take(400)
        }.getOrNull() ?: ""
        conn.disconnect()
        if (code == 401 && attempt == 0) {
          cachedToken = null // 引擎重启过：重读 banner 再试一次
          continue
        }
        return code to text
      } catch (_: Exception) {
        return -1 to ""
      }
    }
    return -1 to ""
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
