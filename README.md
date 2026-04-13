# Hyprbobr

An elegant design implementation for Hyprland featuring a comprehensive suite of notifications, tools, and UI components.

## Features

- **Notifications System** - Elegant notification management and display
- **Integrated Tools** - Full-featured toolkit for Hyprland integration
- **Custom UI Components** - Beautiful, modern interface elements
- **Hyprland Native** - Seamless integration with Hyprland window manager

## Installation

1. Clone the repository
2. Install dependencies as specified in the project documentation / What configurations exactly?
3. Configure your Hyprland setup (see below)

## Hyprland Configuration

Add the following lines to your `~/.config/hypr/hyprland.conf`:

```ini
# Hyprbobr Configuration
layerrule = blur on, match:namespace hyprbobr-bar
layerrule = blur on, match:namespace hyprbobr-volume
layerrule = blur on, match:namespace hyprbobr-notifications
layerrule = ignore_alpha 0.1, match:namespace hyprbobr-bar
layerrule = ignore_alpha 0.1, match:namespace hyprbobr-volume
layerrule = ignore_alpha 0.26, match:namespace hyprbobr-notifications
```

### Keyboard Layout (Language Indicator)

The language indicator manages your keyboard layouts via a dedicated config file. To set it up:

1. Open `~/.config/hypr/hyprland.conf` and find the `input { ... }` block. Remove or comment out the `kb_layout = ...` line:

```ini
input {
    # kb_layout = us,ru   # <-- remove or comment this out
    kb_variant =
    kb_model =
    kb_options = grp:alt_shift_toggle
    ...
}
```

2. Create a new file `~/.config/hypr/keyboard-layouts.conf` with your layout:

```ini
input {
    # Write/paste here your kb_layout setup
    # Or use the default configuration below...
    kb_layout = us
}
```

3. Add a `source` line to `~/.config/hypr/hyprland.conf` so Hyprland picks it up:

```ini
source = ~/.config/hypr/keyboard-layouts.conf
```

After this, the language indicator in the bar will manage `keyboard-layouts.conf` automatically — adding, removing, and switching layouts without touching your main config.

> **Important:** Always put `us` as the **first** layout in `kb_layout`. For example: `kb_layout = us,ru,am`. Placing any other language before `us` can cause keybinding conflicts and other issues in Hyprland. The app will warn you if this rule is violated.

> **Note:** XKB supports a maximum of 4 keyboard layouts at once. Selecting more than 4 will trigger the built-in resolver to help you trim the list.

## Usage

Refer to the project documentation for detailed usage instructions and customization options.