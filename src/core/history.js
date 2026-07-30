import { GeometryDocument } from "./document.js";

export class DocumentHistory {
  constructor(limit = 100) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }

  recordSnapshot(snapshot) {
    if (this.past.at(-1) === snapshot) return;
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(document) {
    if (!this.past.length) return document;
    this.future.push(document.serialize());
    return GeometryDocument.fromJSON(this.past.pop());
  }

  redo(document) {
    if (!this.future.length) return document;
    this.past.push(document.serialize());
    return GeometryDocument.fromJSON(this.future.pop());
  }

  clear() {
    this.past = [];
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}
