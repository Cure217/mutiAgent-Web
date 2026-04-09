# mutiAgent-Web

`mutiAgent-Web` 是 `mutiAgent` 的桌面前端与 Electron 容器工程。

## 技术栈

- `Vue 3`
- `TypeScript`
- `Vite`
- `Pinia`
- `Vue Router`
- `Element Plus`
- `Electron`
- `xterm.js`

## 目录说明

```text
mutiAgent-Web
├─electron
│  ├─main
│  └─preload
├─src
│  ├─api
│  ├─components
│  ├─router
│  ├─stores
│  ├─types
│  └─views
└─package.json
```

## 先决条件

### 后端

先启动后端工程：

```powershell
cd D:\Project\ali\260409\mutiAgent
$env:JAVA_HOME='C:\Users\yucohu\.jdks\ms-17.0.18'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
./gradlew bootRun
```

### 前端

首次安装依赖：

```powershell
cd D:\Project\ali\260409\mutiAgent-Web
npm.cmd install
```

如果 Electron 二进制下载中断，可补一次：

```powershell
node node_modules/electron/install.js
```

## 启动命令

### 仅启动前端 Web

```powershell
npm.cmd run dev:web
```

### 启动 Electron 桌面壳

```powershell
npm.cmd run dev
```

## 当前已接通能力

- 总控制台首页
- 应用实例管理
- 实例测试启动校验
- 会话列表管理
- 会话详情页
- 页内终端键盘直连输入
- 系统设置页与本地配置持久化
- 后端 REST 调用
- 后端 WebSocket 输出监听
- Electron 原生接口：
  - 选择目录
  - 打开路径
  - 打开外部终端

## 下一步建议

- 用 `pty4j` 继续补齐更完整的 TTY 能力（窗口尺寸同步、光标控制、复杂交互）
- 增加历史检索和全文搜索
- 把默认 Shell / 终端视图真正接入终端适配层
- 增加日志清理与配置项生效策略

## 乱码排查

- Windows / PowerShell 场景如果中文乱码，可在实例环境变量中增加：
  - `MUTI_AGENT_CHARSET=GB18030`
- WSL / Linux 场景通常保持 `UTF-8`，可按需设置：
  - `MUTI_AGENT_CHARSET=UTF-8`
- 当前后端会优先读取 `MUTI_AGENT_CHARSET`、`APP_CHARSET`、`PYTHONIOENCODING`，其次根据 `LANG/LC_ALL/LC_CTYPE` 与 `runtimeEnv` 推断字符集
