// Dispatch table mapping "vscode/*" RPC methods from Swift scripts onto the
// real vscode API. Every method here is an explicit, audited exposure —
// scripts only get what is listed below.

import * as vscode from "vscode";
import { Json } from "./rpc";

type ApiHandler = (params: any) => Promise<Json> | Json;

function textOf(params: any): string {
  return typeof params?.message === "string" ? params.message : String(params ?? "");
}

/** API methods callable by Swift userscripts, namespaced as `vscode/<module>.<method>`. */
export const apiHandlers: Record<string, ApiHandler> = {
  "vscode/window.showInformationMessage": async (p) => {
    const picked = await vscode.window.showInformationMessage(textOf(p), ...(p?.items ?? []));
    return picked ?? null;
  },
  "vscode/window.showWarningMessage": async (p) => {
    const picked = await vscode.window.showWarningMessage(textOf(p), ...(p?.items ?? []));
    return picked ?? null;
  },
  "vscode/window.showErrorMessage": async (p) => {
    const picked = await vscode.window.showErrorMessage(textOf(p), ...(p?.items ?? []));
    return picked ?? null;
  },
  "vscode/window.showInputBox": async (p) => {
    const v = await vscode.window.showInputBox({
      prompt: p?.prompt,
      placeHolder: p?.placeHolder,
      value: p?.value,
      password: p?.password === true,
    });
    return v ?? null;
  },
  "vscode/window.showQuickPick": async (p) => {
    const items: string[] = p?.items ?? [];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: p?.placeHolder,
      canPickMany: p?.canPickMany === true,
    });
    return picked ?? null;
  },
  "vscode/window.activeTextEditor": () => {
    const e = vscode.window.activeTextEditor;
    if (!e) return null;
    return {
      uri: e.document.uri.toString(),
      fileName: e.document.fileName,
      languageId: e.document.languageId,
      selection: {
        start: { line: e.selection.start.line, character: e.selection.start.character },
        end: { line: e.selection.end.line, character: e.selection.end.character },
        isEmpty: e.selection.isEmpty,
      },
      selectedText: e.document.getText(e.selection),
    };
  },
  "vscode/workspace.openTextDocument": async (p) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(String(p?.uri)));
    return { uri: doc.uri.toString(), languageId: doc.languageId, text: doc.getText() };
  },
  "vscode/window.showTextDocument": async (p) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(String(p?.uri)));
    await vscode.window.showTextDocument(doc);
    return { uri: doc.uri.toString() };
  },
  "vscode/env.clipboardReadText": async () => {
    return await vscode.env.clipboard.readText();
  },
  "vscode/env.clipboardWriteText": async (p) => {
    await vscode.env.clipboard.writeText(textOf(p));
    return null;
  },
  "vscode/statusBar.setText": (p) => {
    statusBar.text = textOf(p);
    statusBar.show();
    return null;
  },
};

let statusBar: vscode.StatusBarItem;

export function initApi(context: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  context.subscriptions.push(statusBar);
}
