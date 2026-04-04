
# AGENTS

## Overview
This document outlines the technologies and frameworks used in this AGS (Aylur's GTK Shell) project, with references to their official documentation and relevant code implementations.

## Core Technologies

### TypeScript
**Purpose:** Type-safe scripting for AGS configurations  
**Documentation:** https://www.typescriptlang.org/docs/  
**Why:** Provides compile-time type checking for GTK widget definitions and event handlers

### AGS (Aylur's GTK Shell)
**Purpose:** GTK-based shell framework for desktop customization  
**Documentation:** https://aylur.github.io/ags-docs/  
**Usage:** Building custom desktop shells and widgets with reactive property binding

### GJS (GNOME JavaScript)
**Purpose:** JavaScript bindings for GNOME libraries  
**Documentation:** https://gjs.guide/  
**Why:** Provides access to GTK, GLib, and other GNOME functionality from JavaScript/TypeScript

### Astal
**Purpose:** Modern TypeScript library for AGS development  
**Documentation:** Check Astal GitHub repository  
**Usage:** Simplified API layer over GJS for AGS widget creation and management
**Addons:**
- **Astal Hyprland:** Hyprland window manager integration and workspace management
- **Astal Battery:** System battery monitoring and status
- **Astal Bluetooth:** Bluetooth device management
- **Astal Network:** Network connectivity status and WiFi management
- **Astal Mpris:** Media player integration via MPRIS protocol
- **Astal PulseAudio:** Audio and volume control

### Hyprland
**Purpose:** Dynamic tiling Wayland compositor for modern desktop environments  
**Documentation:** https://hyprland.org/  
**Integration:** Native support through Astal Hyprland addon for workspace control, window management, and compositor events

## Development Tools

### Node.js
**Purpose:** JavaScript runtime for development and build processes  
**Documentation:** https://nodejs.org/docs/  
**Version:** Refer to `.nvmrc` or `package.json`

### Build & Package Management
- **npm/pnpm:** Package manager
- **TypeScript Compiler:** Transpilation to JavaScript for AGS

## Code Style Guidelines

Refer to `.claude/CLAUDE.md` for detailed TypeScript and JSON formatting conventions including:
- String literals with single quotes (`''`)
- No semicolons in multi-line code
- PascalCase for classes/enums, camelCase for variables
- 4-space indentation
- Explicit null/undefined checks
- Const-preferring variable declaration

## Documentation References

- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/
- AGS Documentation: https://aylur.github.io/ags-docs/
- GJS Guide: https://gjs.guide/
- Hyprland Documentation: https://hyprland.org/

