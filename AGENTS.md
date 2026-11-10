# TEESimulator 中文版维护

用户希望长期保留简体中文界面并自动同步上游。维护约定见 `docs/zh-CN-maintenance.md`。

- 使用当前已有 checkout。云任务已经隔离；除非用户明确要求，不创建 Git worktree。
- 本 Fork 为 `asmantur/TEESimulator-`，默认中文版维护分支为 `dev`。唯一上游是 `https://github.com/JingMatrix/TEESimulator.git` 的 `dev`。
- 用户要求维护时，先检查工作区与 Actions 失败日志，保留所有已有改动。使用普通合并处理上游更新，不 reset/force-push，不把汉化文件整批替换回英文。
- 汉化只改变展示文本。配置键、协议值、包名、路径、命令、过滤 token 保持原样。上游新增功能需要阅读代码再翻译，不盲目套用旧页面文件。
- 用户不要求全汉化：操作、说明优先中文，难以准确翻译的技术术语保留英文，必要时补中文解释。已审阅术语存于 `scripts/localization/technical-terms.json`，不要为了全中文改写安全级别、密钥类型等上游原意。
- 新增英文检查失败时先定位文本。只将应保留的技术标识或诊断原文加入 `scripts/localization/english-baseline.json`，人工审阅差异；不能自动重建基线让 CI 变绿。
- 检查：安装 `scripts/localization` 的锁定依赖；运行 `node scripts/localization/check.mjs`、`node --test scripts/localization/check.test.mjs module/webroot/tests/domain.test.mjs`、`python3 -m unittest discover -s scripts -p 'test_*.py'`。界面改动应做手机尺寸浏览器验证。
- 发布需要通过 Rust clippy、Gradle `zipRelease zipDebug` 和 `scripts/prepare-zh-release.py` 的产物检查。原生依赖缺失时不能声称完整构建通过。
- 自动维护只在完整验证成功后推送源码；冲突或检查失败时保留报告，不能通过关闭检查、覆盖汉化、强推或修改预期校验和处理。
- WebUI 更新来源和模块管理器更新描述都指向本 Fork；修改时检查两者，避免重新切到上游英文版。保持模块 ID 为 `teesim`，不要触碰设备上的用户配置和私有密钥箱。
- 不自动刷机或发送私有密钥。不要承诺会在聊天关闭后自行开启维护会话；定时执行由 GitHub Actions 完成。
