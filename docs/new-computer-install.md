# 新电脑安装 AI 编程任务图

仓库地址：<https://github.com/httpwzh/ai-coding-task-map>

本项目由两部分组成：

- 根目录：任务图网页，需要在本机 `http://127.0.0.1:4173` 运行。
- `dsh-plugin/`：DeepSeek Harness 的只读插件包。

不要把仓库根目录直接作为 DSH 插件安装。DSH 插件目录是 `dsh-plugin`。

## 推荐安装方式

### 1. 准备 DeepSeek Harness

先安装 DeepSeek Harness，启动一次并完成登录，然后退出。这样 DSH 会创建自己的运行时目录。不要删除或清空 `%USERPROFILE%\.dsh`。

### 2. 使用一键部署脚本

从本仓库下载 `install-dsh-task-map.bat`，双击运行。脚本会：

1. 将项目下载到 `%USERPROFILE%\dsh-task-map`。
2. 安装依赖。
3. 构建任务图网页。
4. 启动本机预览服务。
5. 打开 `http://127.0.0.1:4173`。

脚本不会修改 DSH profile，也不会安装或删除 DSH 插件。

脚本会优先使用系统中的 Git 和 pnpm；如果没有检测到，且 DeepSeek Harness 已经运行过一次，会自动使用 DSH 自带的 Node/pnpm 运行时。如果 Windows 阻止脚本运行，可在 PowerShell 中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-dsh-task-map.ps1
```

也可以指定安装目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-dsh-task-map.ps1 -InstallDir D:\Tools\dsh-task-map
```

### 3. 在 DSH 安装插件

优先在 DSH 的插件管理器中选择“从 GitHub 安装”，输入仓库地址：

<https://github.com/httpwzh/ai-coding-task-map>

仓库根目录现在包含可识别的 DSH 插件入口，同时保留任务图网页。若当前 DSH 版本不接受仓库根地址，则选择“安装本地插件/本地目录”，选择：

```text
%USERPROFILE%\dsh-task-map\dsh-plugin
```

如果当前版本支持 GitHub 子目录，也可以使用：

<https://github.com/httpwzh/ai-coding-task-map/tree/main/dsh-plugin>

不要把网页服务当成 DSH 插件运行；无论采用哪种插件安装方式，`http://127.0.0.1:4173` 都必须保持运行。

安装完成后，完全退出并重新打开 DeepSeek Harness。确认会话输入栏出现“任务图”按钮。

## 日常使用

每次使用任务图前，确保本机服务正在运行：

```text
http://127.0.0.1:4173
```

可以直接双击仓库里的 `启动 AI 编程任务图.bat`。它使用当前 Windows 用户的 `%USERPROFILE%`，不依赖某台电脑的固定用户名。

更新 GitHub 项目后，在项目根目录执行：

```powershell
pnpm install
pnpm build
```

然后重新启动任务图服务。DSH 插件通常不需要重复安装，除非 `dsh-plugin` 的插件代码发生变化。

## 安全边界

- 不要手动编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`。
- 不要把插件配置直接复制到另一台电脑的 profile 中。
- 不要删除 `%USERPROFILE%\.dsh` 来“清理安装”。
- 更新第三方插件前先在 DSH 中备份或使用“禁用第三方插件、备份 profile patch 并重启”。
- 任务图只读取 DSH 会话；本地任务、备注和布局保存在 `127.0.0.1:4173` 浏览器站点数据中。

## 故障处理

### DSH 启动失败

先使用 DSH 错误窗口中的：

```text
Disable third-party plugins, back up profile patch, and restart
```

不要先点击普通的 `Restart`，也不要马上卸载重装。

### DSH 能启动但没有“任务图”按钮

确认：

1. DSH 插件管理器安装的是 `dsh-plugin` 子目录。
2. 插件安装后已完全退出并重新打开 DSH。
3. `http://127.0.0.1:4173` 可以打开。
4. 浏览器或安全软件没有阻止本机服务。

### 任务图按钮能显示但页面打不开

先启动任务图服务，再重新点击“任务图”。检查端口：

```powershell
Test-NetConnection 127.0.0.1 -Port 4173
```

预期 `TcpTestSucceeded` 为 `True`。
