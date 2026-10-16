package com.dsharnessmobile.shell

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.provider.MediaStore
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * 外置 OTG USB（坑 81，2026-10-16）。用户口径：「支持外置OTG USB，驱动能用就行了」——
 * 交付的是系统 USB 主机侧的**可见 + 可授权 + 可达**，不是自带串口芯片驱动。
 *
 * 真机实测边界（OnePlus PJD110，app uid，未 root）决定了实现形态：
 * - `/sys/bus/usb/devices` 与 `/storage` 对 app 域一律 `EACCES`：内核 sysfs 枚举、目录扫描
 *   在沙盒里走不通，只能走框架 API；
 * - `StorageVolume.getPath()` 是 @hide（targetSdk 34 不可依赖），公开面用
 *   `StorageManager.getStorageVolumes()`（API 26+，取 removable/primary/description）
 *   + `MediaStore.getExternalVolumeNames()`（API 29+，卷名 → 约定挂载点 `/storage/<NAME>`）；
 * - `UsbManager.deviceList` 免授权即可枚举，但打开连接做 I/O 必须逐设备
 *   `requestPermission`（系统弹窗），所以状态里一并报 `hasPermission`。
 *
 * 落点与 [AdbState] 同构：状态镜像进 SharedPreferences `dsh-usb`，经
 * [EngineManager.shellEnv] 注入 `DSH_USB_*` 给引擎与其所有子进程，UI 侧走
 * [AndroidBridge] 的 `getUsbState` / `requestUsbPermission`。可移动卷挂载点直接给 shell 用
 * （已授 MANAGE_EXTERNAL_STORAGE，`/storage/<UUID>` 可读写）——这就是「驱动能用」的落点：
 * 内核把 U 盘挂上后，壳侧负责把它变得可见、可授权、可进工作区。
 */
object UsbState {

  private const val TAG = "dsh-usb"
  private const val PREFS = "dsh-usb"
  private const val KEY_STATE = "state"

  @Volatile private var receiverBound = false

  /** 上一次通知过的设备数（拔出/接入去重，防每次广播都弹通知）。 */
  @Volatile private var lastNotified = -1

  fun hasHostFeature(context: Context): Boolean =
    context.packageManager.hasSystemFeature("android.hardware.usb.host")

  /** 最近一次镜像的 JSON（引擎/UI 读这份，不必重复走 system service）。 */
  fun state(context: Context): String =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_STATE, "") ?: ""

  /** 重新枚举 → 落镜像 → 返回 JSON。单点失败只降级为空态，绝不把调用方（探活/启动链）带崩。 */
  fun refresh(context: Context): String {
    val json = try {
      stateJson(context)
    } catch (t: Throwable) {
      JSONObject().apply {
        put("ok", false)
        put("error", t.javaClass.simpleName)
        put("hostFeature", hasHostFeature(context))
        put("devices", JSONArray())
        put("count", 0)
        put("volumes", JSONArray())
      }.toString()
    }
    try {
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit().putString(KEY_STATE, json).apply()
    } catch (t: Throwable) {
      Log.w(TAG, "usb state mirror failed: " + t.message)
    }
    return json
  }

  private fun stateJson(context: Context): String {
    val out = JSONObject()
    out.put("ok", true)
    out.put("hostFeature", hasHostFeature(context))
    val devices = JSONArray()
    val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager
    val list = manager?.deviceList?.values?.sortedWith(
      compareBy({ it.vendorId }, { it.productId }, { it.deviceName })
    ) ?: emptyList()
    for (d in list) {
      val o = JSONObject()
      o.put("name", d.deviceName)
      o.put("vendorId", d.vendorId)
      o.put("productId", d.productId)
      // 设备字符串描述符要权限才拿得到；未授权时为 null 属正常，不能当错误。
      d.productName?.let { o.put("product", it) }
      d.manufacturerName?.let { o.put("manufacturer", it) }
      o.put("deviceClass", d.deviceClass)
      o.put("deviceSubclass", d.deviceSubclass)
      o.put("deviceProtocol", d.deviceProtocol)
      o.put("hasPermission", manager != null && manager.hasPermission(d))
      val ifaces = JSONArray()
      for (i in 0 until d.interfaceCount) {
        val it0 = d.getInterface(i)
        ifaces.put(JSONObject()
          .put("id", it0.id)
          .put("class", it0.interfaceClass)
          .put("subclass", it0.interfaceSubclass)
          .put("protocol", it0.interfaceProtocol))
      }
      o.put("interfaces", ifaces)
      devices.put(o)
    }
    out.put("devices", devices)
    out.put("count", devices.length())
    out.put("volumes", volumesJson(context))
    return out.toString()
  }

  /**
   * 可移动卷（OTG U 盘 / SD）：`getStorageVolumes()` 给 removable/primary 与描述，
   * 挂载点取 `MediaStore.getExternalVolumeNames()` 的卷名（约定 `/storage/<NAME>`），
   * 并用 `listFiles() != null` 实测该点在本 app 域内是否真可达（可达 = 「驱动能用」的判据）。
   */
  private fun volumesJson(context: Context): JSONArray {
    val arr = JSONArray()
    val removableNames = HashSet<String>()
    try {
      val sm = context.getSystemService(Context.STORAGE_SERVICE) as? StorageManager
      val volumes: List<StorageVolume> = sm?.storageVolumes ?: emptyList()
      for (v in volumes) {
        if (!v.isRemovable || v.isPrimary) continue
        val name = try { v.getMediaStoreVolumeName() } catch (_: Throwable) { null }
          ?: v.getDescription(context)
        if (name != null) removableNames.add(name)
      }
    } catch (t: Throwable) {
      Log.i(TAG, "storageVolumes unavailable: " + t.javaClass.simpleName)
    }
    val names = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
        MediaStore.getExternalVolumeNames(context) else emptySet()
    } catch (t: Throwable) {
      emptySet<String>()
    }
    for (name in names.sorted()) {
      if (name == "primary" || name.equals("emulated", ignoreCase = true)) continue
      val path = "/storage/" + name
      val o = JSONObject()
      o.put("name", name)
      o.put("path", path)
      o.put("removable", removableNames.contains(name))
      val dir = File(path)
      o.put("reachable", dir.isDirectory && dir.listFiles() != null)
      arr.put(o)
    }
    return arr
  }

  /** 申请某设备的 USB 访问权限（系统弹窗）。设备已消失/无服务时返回机器可读 reason。 */
  fun requestPermission(context: Context, deviceName: String): String {
    val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager
      ?: return """{"ok":false,"reason":"no-usb-service"}"""
    val device = manager.deviceList[deviceName]
      ?: return """{"ok":false,"reason":"device-gone"}"""
    if (manager.hasPermission(device)) return """{"ok":true,"reason":"already-granted","name":""" +
      JSONObject.quote(deviceName) + "}"
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
      PendingIntent.FLAG_IMMUTABLE else 0
    // 广播必须显式回到本包：否则是隐式系统广播，Android 13+ 直接投递失败。
    val intent = Intent(UsbManager.ACTION_USB_DEVICE_ATTACHED).setPackage(context.packageName)
    val pi = PendingIntent.getBroadcast(context.applicationContext, 0, intent, flags)
    return try {
      manager.requestPermission(device, pi)
      JSONObject().put("ok", true).put("reason", "prompt-shown").put("name", deviceName).toString()
    } catch (t: Throwable) {
      JSONObject().put("ok", false).put("reason", t.javaClass.simpleName).toString()
    }
  }

  /**
   * 注册接入/拔出广播（幂等；MainActivity 与 EngineService 都调，谁先到谁注册）。
   * 拔出只能动态注册收（清单声明的 ATTACHED filter 需要 device_filter.xml 的具体 vid/pid，
   * 我们不做「只认某颗芯片」的白名单）。
   */
  fun ensureReceiver(context: Context) {
    if (receiverBound) return
    synchronized(this) {
      if (receiverBound) return
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
          val json = refresh(ctx)
          val n = try { JSONObject(json).optInt("count", 0) } catch (_: Throwable) { 0 }
          LogCollector.log(TAG, "usb " + intent.action + "; devices=" + n)
          if (n == lastNotified) return
          lastNotified = n
          if (n <= 0) return
          val summary = try {
            val a = JSONObject(json).optJSONArray("devices") ?: JSONArray()
            (0 until a.length()).joinToString(", ") { i ->
              val d = a.optJSONObject(i)
              "VID_" + Integer.toHexString(d?.optInt("vendorId", 0) ?: 0).uppercase() +
                ":PID_" + Integer.toHexString(d?.optInt("productId", 0) ?: 0).uppercase()
            }
          } catch (_: Throwable) { "" }
          try {
            NotifyCenter.notify(ctx, "usb", "OTG USB：$n 个设备在场", summary)
          } catch (t: Throwable) {
            Log.w(TAG, "usb notify failed: " + t.message)
          }
        }
      }
      val filter = IntentFilter().apply {
        addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
        addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.applicationContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
          context.applicationContext.registerReceiver(receiver, filter)
        }
        receiverBound = true
        lastNotified = -1
        refresh(context)
        LogCollector.log(TAG, "usb host receiver registered; hostFeature=" + hasHostFeature(context))
      } catch (t: Throwable) {
        Log.w(TAG, "usb receiver registration failed: " + t.message)
      }
    }
  }

  /** 注入引擎环境（与 DSH_ADB_* 同一处调用，覆盖引擎与其全部工具子进程）。 */
  fun env(context: Context): Map<String, String> {
    val json = try { refresh(context) } catch (_: Throwable) { "{}" }
    val n = try { JSONObject(json).optInt("count", 0) } catch (_: Throwable) { 0 }
    val mounts = try {
      val a = JSONObject(json).optJSONArray("volumes") ?: JSONArray()
      (0 until a.length()).mapNotNull { i ->
        val v = a.optJSONObject(i)
        if (v != null && v.optBoolean("reachable", false)) v.optString("path") else null
      }.joinToString(":")
    } catch (_: Throwable) { "" }
    return mapOf(
      "DSH_USB_HOST" to if (hasHostFeature(context)) "1" else "0",
      "DSH_USB_COUNT" to n.toString(),
      // 结构化清单整串交给引擎（沙盒里读不到 /sys，别再让引擎自己猜）；长度封顶防 execve 参数超限。
      "DSH_USB_STATE" to if (json.length <= 6000) json else "",
      "DSH_USB_MOUNTS" to mounts,
    )
  }
}
