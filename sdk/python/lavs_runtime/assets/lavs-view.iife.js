"use strict";
var LAVSView = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    LAVSView: () => LAVSView,
    connect: () => connect,
    handleAgentAction: () => handleAgentAction
  });
  function handleAgentAction(action, handlers) {
    if (!action || !action.type) return "ignored";
    handlers.onAction?.(action);
    if (action.type === "ui_command" && action.command) {
      const cmd = handlers.commands?.[action.command];
      if (cmd) {
        cmd(action.args ?? {});
        return "command";
      }
      handlers.refresh({ command: action.command, args: action.args });
      return "refresh";
    }
    handlers.refresh();
    return "refresh";
  }
  var LAVSView = class {
    constructor(win = window, parent = window.parent, options = {}) {
      this.win = win;
      this.parent = parent;
      this.refreshFn = options.refresh ?? (() => {
      });
      this.commands = { ...options.commands };
      this.onAction = options.onAction;
      this.listen();
    }
    callId = 0;
    pending = /* @__PURE__ */ new Map();
    commands = {};
    refreshFn;
    onAction;
    listener = null;
    listen() {
      if (!this.parent) return;
      this.listener = (e) => {
        const d = e.data;
        if (!d || typeof d !== "object") return;
        if (d.type === "lavs-result" && this.pending.has(d.id)) {
          this.pending.get(d.id).resolve(d.result);
          this.pending.delete(d.id);
        } else if (d.type === "lavs-error" && this.pending.has(d.id)) {
          this.pending.get(d.id).reject(new Error(d.error || "Unknown error"));
          this.pending.delete(d.id);
        } else if (d.type === "lavs-agent-action") {
          handleAgentAction(d.action, {
            refresh: (detail) => this.refreshFn(detail),
            commands: this.commands,
            onAction: this.onAction
          });
        }
      };
      this.win.addEventListener("message", this.listener);
    }
    /** Register (or replace) a UI command handler. */
    registerCommand(name, fn) {
      this.commands[name] = fn;
      return this;
    }
    /** Replace the refresh handler. */
    onRefresh(fn) {
      this.refreshFn = fn;
      return this;
    }
    /** Call a manifest endpoint through the host bridge. */
    call(endpoint, input = {}) {
      return new Promise((resolve, reject) => {
        if (!this.parent) {
          reject(new Error("LAVSView: no parent host (not running inside the LAVS host iframe?)"));
          return;
        }
        const id = String(++this.callId);
        this.pending.set(id, { resolve, reject });
        this.parent.postMessage({ type: "lavs-call", id, endpoint, input }, "*");
      });
    }
    /** Stop listening (cleanup in SPA hosts). */
    destroy() {
      if (this.listener) this.win.removeEventListener("message", this.listener);
      this.listener = null;
      for (const { reject } of this.pending.values()) reject(new Error("LAVSView destroyed"));
      this.pending.clear();
    }
  };
  function connect(options = {}) {
    return new LAVSView(window, window.parent, options);
  }
  return __toCommonJS(src_exports);
})();
