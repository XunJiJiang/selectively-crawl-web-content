# Context menu provenance

Copied 2026-10-18 from `projects/server/plugins/sticker-management/web/src/components/context-menu/` at repository HEAD `1608767`, with the accompanying local root-click fix. The source component was verified before copying (backdrop dismissal, override, reopening and disabled actions).

The two components retain submenu positioning, scroll viewports, keyboard and native-picker fallback behavior. Tags/events use `wb-`; business types and styles were replaced with local menu types, minimal helpers, a new icon adapter and workbench semantic tokens. There are no runtime or test imports from the plugin. Subsequent behavior fixes should be considered for both copies.
