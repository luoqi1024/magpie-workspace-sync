import assert from "node:assert/strict"
import { test } from "node:test"
import { baseName, display, fromFileUri, norm, toFileUri } from "../src/paths.js"

const win = { win: true }
const posix = { win: false }

test("norm: the same Windows folder spelled differently is one key", () => {
  const spellings = ["D:\\Dev\\Work\\App", "d:/dev/work/app/", "\\\\?\\D:\\dev\\work\\app", "D:\\\\dev\\work\\app\\"]
  for (const s of spellings) assert.equal(norm(s, win), "d:\\dev\\work\\app", s)
})

test("norm: drive roots, UNC and WSL paths", () => {
  assert.equal(norm("C:\\", win), "c:\\")
  assert.equal(norm("C:", win), "c:\\")
  assert.equal(norm("\\\\?\\UNC\\wsl.localhost\\Ubuntu\\home\\me\\p", win), "\\\\wsl.localhost\\ubuntu\\home\\me\\p")
  assert.equal(norm("\\\\wsl$\\Ubuntu\\home\\me\\p", win), "\\\\wsl.localhost\\ubuntu\\home\\me\\p")
})

test("norm: POSIX keeps case and drops the trailing slash", () => {
  assert.equal(norm("/home/Me/proj/", posix), "/home/Me/proj")
  assert.notEqual(norm("/home/me/proj", posix), norm("/home/Me/proj", posix))
  assert.equal(norm("", posix), "")
  assert.equal(norm(null, posix), "")
})

test("display keeps case, fixes slashes and the drive letter", () => {
  assert.equal(display("d:/Dev/App/", win), "D:\\Dev\\App")
  assert.equal(display("\\\\?\\D:\\x", win), "D:\\x")
})

test("baseName", () => {
  assert.equal(baseName("D:\\a\\b\\proj"), "proj")
  assert.equal(baseName("/a/b/proj/"), "proj")
})

test("file URIs round-trip with Antigravity's own spelling", () => {
  const p = "D:\\dev\\workspace\\code\\项目 一"
  const uri = toFileUri(p, win)
  assert.equal(uri, "file:///d%3A/dev/workspace/code/%E9%A1%B9%E7%9B%AE%20%E4%B8%80")
  assert.equal(fromFileUri(uri, win), p)
  assert.equal(norm(fromFileUri(uri, win), win), norm(p, win))
})

test("file URIs: UNC host and posix", () => {
  const unc = "\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\p"
  assert.equal(toFileUri(unc, win), "file://wsl.localhost/Ubuntu-24.04/home/me/p")
  assert.equal(fromFileUri("file://wsl.localhost/Ubuntu-24.04/home/me/p", win), unc)
  assert.equal(fromFileUri("file:///home/me/p", posix), "/home/me/p")
  assert.equal(fromFileUri("vscode-remote://ssh/x", win), "")
})
