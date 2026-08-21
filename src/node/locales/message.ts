export const messageZh = {
    commands: {
        plugin: {
            description: "插件管理",
            install: {
                description: "安装插件",
                messages: {
                    "expect-name": "请输入插件名。",
                    "already-installed": "该插件已安装。",
                    "not-found": "未找到该插件。",
                    success: "安装成功！",
                },
            },
            uninstall: {
                description: "卸载插件",
                messages: {
                    "expect-name": "请输入插件名。",
                    "not-installed": "该插件未安装。",
                    success: "卸载成功！",
                },
            },
            upgrade: {
                description: "升级插件",
                options: {
                    self: "升级 Koishi 本体",
                    force: "忽略更新屏蔽规则并强制检查",
                },
                messages: {
                    "all-updated": "所有插件已是最新版本。",
                    available: "有可用的依赖更新：",
                    prompt: "输入「Y」升级全部依赖，输入「N」取消操作。",
                    cancelled: "已取消操作。",
                    failed: "升级失败，包管理器退出码为 {0}。",
                    success: "升级成功！",
                },
            },
            "clear-avatar-cache": {
                description: "清理 market-next 头像缓存",
                messages: {
                    success: "已清理头像缓存：内存 {0} 条，磁盘 {1} 个文件。",
                },
            },
        },
    },
};

export const messageEn = {
    commands: {
        plugin: {
            description: "Plugin management",
            install: {
                description: "Install Plugins",
                messages: {
                    "expect-name": "Please enter a plugin name.",
                    "already-installed": "This plugin is already installed.",
                    "not-found": "Plugin not found.",
                    success: "Installation Successful!",
                },
            },
            uninstall: {
                description: "Uninstall plugin",
                messages: {
                    "expect-name": "Please enter a plugin name.",
                    "not-installed": "This plugin is not installed.",
                    success: "Uninstalled successfully!",
                },
            },
            upgrade: {
                description: "Upgrade Plugin",
                options: {
                    self: "Upgrade Koishi core",
                    force: "Ignore update rules and force an update check",
                },
                messages: {
                    "all-updated": "All plugins are already up to date.",
                    available: "Available dependency updates:",
                    prompt: "Enter Y to upgrade all dependencies, or N to cancel.",
                    cancelled: "Operation canceled.",
                    failed: "Upgrade failed with package manager exit code {0}.",
                    success: "Upgrade Successful!",
                },
            },
            "clear-avatar-cache": {
                description: "Clear market-next avatar cache",
                messages: {
                    success: "Cleared avatar cache: {0} memory entries, {1} disk files.",
                },
            },
        },
    },
};
