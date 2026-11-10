# 简体中文版自动维护

**当前已暂停自动更新**：按用户要求，已移除定时和 push 自动触发，仅保留手动运行入口。用户明确要求恢复后才重新启用自动运行。

只需保留 `asmantur/TEESimulator-` 这一个 Fork，不必每次重新 Fork，也不必定期手动点击 Sync fork。

本方案使用现有默认分支 `dev` 作为中文版维护线。GitHub 的定时工作流只在默认分支执行，因此不另建一个无法自动定时运行的汉化分支。原作者 `JingMatrix/TEESimulator` 的 `dev` 是唯一上游来源。

## 自动处理的事情

工作流：[中文版自动维护](https://github.com/asmantur/TEESimulator-/actions/workflows/zh-cn.yml)。目前仅手动点击 **Run workflow** 时运行。原每天 01:00 UTC（新加坡时间约 09:00）的定时任务及 `dev` 推送触发均已暂停。

1. 拉取上游固定提交，在临时 runner 内做普通合并，不强制覆盖中文版。
2. 检查新增英文字符串、配置验证逻辑、维护脚本和 WebUI 语法。
3. 安装合并后源码指定的 Java、SDK、NDK，检查 Rust，构建 Release/Debug、arm64/x86_64 完整模块。
4. 检查 ZIP 包含中文 WebUI、daemon 和双架构原生文件。
5. 上述步骤通过后才推送合并提交到 `dev`，发布 `canary-<版本号>` 中文版。Releases 附件只放可刷入的 Release/Debug 模块 ZIP。
6. ZIP 上传成功后，将 `update.json` 和更新说明原子提交到 `updates` 分支，通过 raw.githubusercontent.com 提供自动更新信息。模块管理器和 WebUI 均从你的仓库检查更新，不会主动切回作者的英文发行版。校验和与诊断文件仅留在 Actions 产物，不放进 Releases。

定时检查没有新提交时会直接结束；手动运行会重新构建当前版本。提交使用 GitHub 自带的 `GITHUB_TOKEN`，不需要额外提供个人 token。机器人推送不会再次触发本工作流，避免循环构建。上游的旧 Build 工作流在本 Fork 中跳过，由中文工作流负责构建与发布。

## 需要维护者接手的情况

- 上游改动与汉化冲突：中止合并，保持远端 `dev` 原样，记录冲突文件。
- 出现未审阅的新增英文或技术字符串：停止构建。检查用户可见文字，翻译后再决定是否把确属协议、路径、标识符或诊断信息的字符串加入基线。
- 测试、下载、编译、推送或发布失败：停止后续步骤，在 Actions Summary 与诊断产物中记录结果。不要绕过校验或强推。

所有构建验证都通过后才会推送源码。如果后面的 GitHub 发布步骤失败，源码可能已经更新，但旧更新描述仍保留；修复原因后手动重跑工作流即可。若恰好有人同时更新了 `dev` 或 `updates`，普通推送会拒绝，避免丢失其提交。`updates` 只用于更新元数据，不会触发默认分支的定时构建。

汉化不要求全中文，难以准确翻译的术语保留英文。检查器允许 `scripts/localization/technical-terms.json` 中已审阅的技术术语；其余新增纯英文字符串（包括技术常量）可能要求人工审阅。它不翻译文本，不覆盖运行时后端返回内容，也不能替代设备测试。当前版本基线位于 `scripts/localization/english-baseline.json`；工作流不会自动放宽它。

需要继续维护时，向 Codex 发送“维护 TEESimulator 中文版”，附上失败的 Actions 链接即可。仓库根目录的 `AGENTS.md` 记录了处理步骤。GitHub Actions 执行定时任务；聊天中的 Codex 不会在后台自行开启新会话或收到失败通知。

## 首次启用与排查

将本次源码与工作流推送到仓库后，在 Actions 页面确认工作流允许运行。Fork 可能需要首次启用 Actions；首次运行成功前，`updates` 分支的更新入口可能尚不存在。可以手动运行“中文版自动维护”完成首次发布。

早期 `canary-77` 的模块管理器更新地址指向已移除的独立元数据 Release。该版本可通过 WebUI 更新或手动刷入新版完成迁移；新版模块管理器更新地址改为 `updates` 分支。流程会在新更新信息发布成功后清理旧元数据 Release 和旧的 SHA256SUMS 附件。

本方案不修改你的设备，也不自动刷机；有新版后由你安装。仓库若保护了 `dev`、限制 Actions 写入或发布权限，需要按失败信息调整仓库设置。公共仓库长期没有活动时，GitHub 也可能暂停定时工作流，可在 Actions 页面重新启用。

检查命令（源码仓库根目录）：

```sh
npm ci --prefix scripts/localization --ignore-scripts --no-audit --no-fund
node scripts/localization/check.mjs
node --test scripts/localization/check.test.mjs module/webroot/tests/domain.test.mjs
python3 -m unittest discover -s scripts -p 'test_*.py'
```

人工确认新增英文确属应保留的技术文本后，才执行：

```sh
node scripts/localization/check.mjs --write-baseline
git diff -- scripts/localization/english-baseline.json
```

检查基线差异后再提交，不要用此命令掩盖漏译。
