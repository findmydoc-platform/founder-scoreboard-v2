import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

class FakeElement {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.parentElement = null;
    this.inert = false;
    this.isConnected = true;
    this.style = { overflow: "", overscrollBehavior: "", zIndex: "" };
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }

  contains(target) {
    let current = target;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }
}

function createOverlayTree() {
  const root = new FakeElement("root");
  const main = new FakeElement("main");
  const workspace = new FakeElement("workspace");
  const github = new FakeElement("github");
  const overlayLayer = new FakeElement("overlay-layer");
  const detail = new FakeElement("detail");
  const body = new FakeElement("body").append(root);
  const documentElement = new FakeElement("html").append(body);

  root.append(main, overlayLayer);
  main.append(workspace);
  workspace.append(github);
  overlayLayer.append(detail);

  globalThis.HTMLElement = FakeElement;
  globalThis.document = { body, documentElement };
  return { body, detail, github, main, overlayLayer };
}

const modalStack = await loadTranspiledModule("src/shared/model/modal-stack.ts");

test("a modal opened inside an inert background branch becomes the active top layer", () => {
  const { body, detail, github, main, overlayLayer } = createOverlayTree();

  modalStack.registerModal(detail);
  assert.equal(main.inert, true);
  assert.equal(body.style.overflow, "hidden");

  modalStack.registerModal(github);
  assert.equal(main.inert, false);
  assert.equal(overlayLayer.inert, true);
  assert.equal(detail.inert, true);
  assert.equal(github.inert, false);
  assert.ok(Number(github.style.zIndex) > Number(detail.style.zIndex));

  const closed = modalStack.unregisterModal(github);
  assert.equal(closed.wasTopModal, true);
  assert.equal(closed.nextTopModal, detail);
  assert.equal(main.inert, true);
  assert.equal(overlayLayer.inert, false);
  assert.equal(detail.inert, false);
  assert.equal(body.style.overflow, "hidden");

  modalStack.unregisterModal(detail);
  assert.equal(main.inert, false);
  assert.equal(body.style.overflow, "");
});

test("visual order follows opening order across separate DOM branches", () => {
  const { body, detail, github, main, overlayLayer } = createOverlayTree();

  modalStack.registerModal(github);
  assert.equal(overlayLayer.inert, true);

  modalStack.registerModal(detail);
  assert.equal(main.inert, true);
  assert.equal(overlayLayer.inert, false);
  assert.equal(github.inert, true);
  assert.equal(detail.inert, false);
  assert.ok(Number(detail.style.zIndex) > Number(github.style.zIndex));

  modalStack.unregisterModal(detail);
  assert.equal(overlayLayer.inert, true);
  assert.equal(github.inert, false);
  assert.equal(body.style.overflow, "hidden");

  modalStack.unregisterModal(github);
  assert.equal(overlayLayer.inert, false);
  assert.equal(body.style.overflow, "");
});

test("closing a background modal does not unlock or reorder the active modal", () => {
  const { body, detail, github } = createOverlayTree();

  modalStack.registerModal(detail);
  modalStack.registerModal(github);

  const closed = modalStack.unregisterModal(detail);
  assert.equal(closed.wasTopModal, false);
  assert.equal(closed.nextTopModal, github);
  assert.equal(github.inert, false);
  assert.equal(modalStack.isTopModal(github), true);
  assert.ok(Number(github.style.zIndex) >= 80);
  assert.equal(body.style.overflow, "hidden");

  modalStack.unregisterModal(github);
  assert.equal(body.style.overflow, "");
});
