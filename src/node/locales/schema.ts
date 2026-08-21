export const schemaZh = {
    registry: {
        $description: "插件源设置",
        endpoint: "插件的下载源。默认跟随当前项目的 npm config。",
        timeout: "获取插件数据的超时时间。",
        autoRoute: "当前下载源获取版本失败时自动尝试备用 npm 源。",
        retry: "每个 npm 源获取版本失败后的重试次数。",
        concurrency: "批量获取依赖版本时的最大并发数。",
        installLogRetentionHours: "依赖安装、更新与卸载操作日志保留多少小时，默认 72 小时。",
    },
    search: {
        $description: "搜索设置",
        endpoint: "用于搜索插件市场的网址。默认使用 t4wefan 镜像。",
        timeout: "搜索插件市场的超时时间。",
        proxyAgent: "用于搜索插件市场的代理。",
        autoRoute: "当前市场源失败时自动尝试备用市场源。",
        logLevel: "插件市场调试日志级别。silent 关闭日志，debug 输出最详细。",
    },
    marketSilentFilters: "旧版永久静默过滤。",
    idleProbe:
        "Console 空闲时自动探测依赖版本和插件市场数据。仅在没有浏览器控制台连接时运行，不会因为刷新页面触发。",
    idleProbeDelay: "Console 无人在线多久后开始后台探测。",
    idleProbeBootDelay: "Koishi 启动或重载后，至少等待多久才允许空闲探测。",
    idleProbeInterval: "两次空闲后台探测之间的最小间隔。",
    bulkMode: "批量操作模式。开启后安装、更新、卸载会先暂存，点击“应用更改”后执行。",
    removeConfig: {
        $description: "卸载插件时是否同时删除已有插件配置。未设置时每次询问。",
        $inner: ["每次询问", "始终删除插件配置", "永不删除插件配置"],
    },
    updateIgnoredPackages: "不检测更新的依赖名。每行一个包名，也可以使用逗号、分号或空格分隔。",
    updateIgnoreDuration: "点击“忽略此次更新”后的默认忽略时长。0 表示不按时间过期。",
    updateIgnoreVersions: "点击“忽略此次更新”后连续忽略几个新版本。1 表示只忽略当前最新版本。",
    updateIgnorePrerelease: "手动开启后，alpha / beta / rc 等预发布版本不会被视为可更新版本。",
    chatlunaTool:
        "启用 ChatLuna 插件市场查询工具。启用后，若当前 Koishi 同时安装了 ChatLuna，会注册只读工具 koishi_plugin_market_search。",
    frontendMode: {
        $description: "前端显示模式。性能模式保持低动效；精致模式启用更细腻的动效和高级样式。",
        $inner: ["性能模式", "精致模式"],
    },
    depsLayout: {
        $description: "依赖管理页布局。网格模式多列展示；列表模式单列宽卡片，信息更密集。",
        $inner: ["网格", "列表"],
    },
    marketSilentRules: {
        $description: "插件市场永久静默过滤。添加后命中的插件会直接隐藏，不会显示在搜索框中。",
        type: {
            $description: "规则类型",
            $inner: [
                "状态：预览版插件",
                "状态：不安全插件",
                "状态：插件包",
                "创建时间：早于指定日期",
                "创建时间：晚于指定日期",
                "更新时间：早于指定日期",
                "更新时间：晚于指定日期",
                "创建时间：最近 N 天内",
                "更新时间：最近 N 天内",
                "自定义高级条件",
            ],
        },
        value: "规则值。状态类留空；日期类填写 YYYY-MM-DD；最近 N 天填写数字；自定义规则填写搜索条件。",
        note: "备注",
        enabled: "是否启用",
    },
};

export const schemaEn = {
    registry: {
        $description: "Registry settings",
        endpoint: "Package download source. Follows the current project's npm config by default.",
        timeout: "Timeout for fetching package metadata.",
        autoRoute:
            "Automatically try fallback npm registries when version metadata cannot be fetched from the current registry.",
        retry: "Retry count after version metadata fails on each npm registry.",
        concurrency: "Maximum concurrency when loading dependency version metadata.",
        installLogRetentionHours:
            "How many hours dependency operation logs are retained. Defaults to 72 hours.",
    },
    search: {
        $description: "Search settings",
        endpoint: "URL used to search the plugin market. Uses the t4wefan mirror by default.",
        timeout: "Timeout for searching the plugin market.",
        proxyAgent: "Proxy used to search the plugin market.",
        autoRoute: "Automatically try fallback market sources when the current source fails.",
        logLevel: "Plugin market log level. silent disables logs; debug enables detailed logs.",
    },
    marketSilentFilters: "Legacy permanent silent filters.",
    idleProbe:
        "Automatically probes dependency versions and market data while Console is idle. It only runs when no browser console is connected, and page reloads do not trigger it.",
    idleProbeDelay: "How long Console must stay idle before the background probe starts.",
    idleProbeBootDelay:
        "Minimum delay after Koishi startup or reload before idle probing is allowed.",
    idleProbeInterval: "Minimum interval between idle background probes.",
    bulkMode:
        "Batch operation mode. Dependency install, update, and uninstall actions are staged until applying changes.",
    removeConfig: {
        $description:
            "Whether to remove existing plugin config when uninstalling a plugin. Ask every time when unset.",
        $inner: ["Ask every time", "Always remove plugin config", "Never remove plugin config"],
    },
    updateIgnoredPackages:
        "Dependency package names that should not be checked for updates. One package per line, or separated by commas, semicolons, or spaces.",
    updateIgnoreDuration:
        "Default duration after ignoring one update. 0 means no time-based expiry.",
    updateIgnoreVersions:
        "How many consecutive newer versions should be ignored after ignoring one update. 1 means only the current latest version.",
    updateIgnorePrerelease:
        "When enabled, alpha / beta / rc and other prerelease versions are not treated as update targets.",
    chatlunaTool:
        "Enable the ChatLuna plugin market query tool. When ChatLuna is installed, this registers the read-only koishi_plugin_market_search tool.",
    frontendMode: {
        $description:
            "Frontend display mode. Performance mode keeps low-motion dense UI; polished mode enables richer visual effects.",
        $inner: ["Performance mode", "Polished mode"],
    },
    depsLayout: {
        $description:
            "Dependencies page layout. Grid shows compact cards; list shows a denser single-column view.",
        $inner: ["Grid", "List"],
    },
    marketSilentRules: {
        $description:
            "Permanent silent market filters. Matched plugins are hidden from the market page.",
        type: {
            $description: "Rule type",
            $inner: [
                "Status: plugin in development",
                "Status: insecure plugin",
                "Status: plugin bundle",
                "Created before a date",
                "Created after a date",
                "Updated before a date",
                "Updated after a date",
                "Created within the last N days",
                "Updated within the last N days",
                "Custom advanced condition",
            ],
        },
        value: "Rule value. Leave status rules empty; use YYYY-MM-DD for dates, a number for recent-day rules, or a search condition for custom rules.",
        note: "Note",
        enabled: "Enabled",
    },
};
