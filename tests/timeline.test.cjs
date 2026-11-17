const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const typescript = require("typescript");

const sourcePath = path.join(__dirname, "..", "TimeLineControl", "index.ts");
const compiled = typescript.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 }
});
const controlModule = new Module(sourcePath, module);
controlModule._compile(compiled.outputText, sourcePath);
const { TimeLineControl } = controlModule.exports;

test("parses task JSON and skips invalid records", () => {
    const control = new TimeLineControl();
    const json = JSON.stringify([
        { id: 42, title: "Task", start: "2026-01-01", end: "2026-01-02", status: "Completed" },
        { title: "Invalid", start: "invalid", end: "2026-01-02" },
        null
    ]);

    assert.deepEqual(control.parseTasks(json), [{
        id: "42", title: "Task", start: "2026-01-01", end: "2026-01-02", status: "Completed"
    }]);
    assert.deepEqual(control.parseTasks("not json"), []);
    assert.deepEqual(control.parseTasks("{}"), []);
    assert.deepEqual(control.parseTasks(null), []);
});

test("selection exposes both outputs and fires again for unchanged selections", () => {
    const control = new TimeLineControl();
    let notifications = 0;
    let events = 0;
    control.renderSelection = () => { };
    control.notifyOutputChanged = () => notifications++;
    control.context = { events: { OnTaskSelected: () => events++ } };
    const task = { id: "42", title: "Task", start: "2026-01-01", end: "2026-01-02" };

    control.selectTask(task, {});
    assert.deepEqual(control.getOutputs(), { SelectedTaskId: "42", SelectedTaskJson: JSON.stringify(task) });
    assert.equal(notifications, 1);
    control.selectTask(task, {});
    assert.equal(events, 1);
});