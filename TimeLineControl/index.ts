import { IInputs, IOutputs } from "./generated/ManifestTypes";

type ViewMode = "hourly" | "daily" | "monthly" | "quarterly";
interface TimelineTask {
  id?: string;
  description?: string;
  title?: string;
  start: string;
  end: string;
  color?: string;
  status?: string;
}

export class TimeLineControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private context!: ComponentFramework.Context<IInputs>;
  private selectedTaskJson = "";
  private notifyOutputChanged!: () => void;
  private mode: ViewMode = "daily";
  private resizeObserver?: ResizeObserver;
  private selectedTaskId = "";
  private pendingEvent?: "OnTaskSelected" | "OnEditTask";
  private taskDurationHours = 8;

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged?: () => void,
    state?: ComponentFramework.Dictionary,
    container?: HTMLDivElement
  ): void {
    this.context = context;
    this.notifyOutputChanged = notifyOutputChanged ?? (() => undefined);

    if (!container) {
      return;
    }

    this.container = container;
    this.container.classList.add("tl-root");
    context.mode.trackContainerResize(true);

    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.container);

    this.mode = this.parseMode(context.parameters.DefaultView.raw);
  }


  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    this.render();
    // Output values are only visible to the app on the update after notifyOutputChanged.
    if (this.pendingEvent) {
      const eventName = this.pendingEvent;
      this.pendingEvent = undefined;
      this.context.events[eventName]();
    }
  }

  private selectTask(task: TimelineTask, taskCell: HTMLButtonElement, eventName: "OnTaskSelected" | "OnEditTask" = "OnTaskSelected"): void {
    this.renderSelection(taskCell);
    const newId = String(task.id ?? "");
    const taskJson = JSON.stringify(task);
    // An unchanged output won't trigger updateView, so fire immediately.
    if (newId === this.selectedTaskId && taskJson === this.selectedTaskJson) {
      this.context.events[eventName]();
      return;
    }
    this.selectedTaskId = newId;
    this.selectedTaskJson = taskJson;
    this.pendingEvent = eventName;
    this.notifyOutputChanged();
  }

  public getOutputs(): IOutputs {
    return {
      SelectedTaskId: this.selectedTaskId,
      SelectedTaskJson: this.selectedTaskJson
    };
  }

  public destroy(): void {
    this.resizeObserver?.disconnect();
  }

  private parseMode(value: string | null | undefined): ViewMode {
    const v = (value || "daily").toLowerCase();
    return v === "hourly" || v === "monthly" || v === "quarterly" ? v : "daily";
  }

  private parseTasks(json: string | null | undefined): TimelineTask[] {
    let records: unknown;
    try {
      records = JSON.parse(json || "[]") as unknown;
    } catch {
      return [];
    }
    if (!Array.isArray(records)) return [];

    return records.flatMap((record: unknown) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return [];
      const { id, start, end, description, title, color, status } = record as Record<string, unknown>;
      if (typeof start !== "string" || typeof end !== "string" || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start) || (typeof description !== "string" && typeof title !== "string")) return [];

      return [{
        ...(typeof id === "string" || typeof id === "number" ? { id: String(id) } : {}),
        start,
        end,
        ...(typeof description === "string" ? { description } : {}),
        ...(typeof title === "string" ? { title } : {}),
        ...(typeof color === "string" ? { color } : {}),
        ...(typeof status === "string" ? { status } : {})
      }];
    });
  }

  private render(): void {
    if (!this.container) return;
    const allocatedHeight = this.context.mode.allocatedHeight;
    this.container.style.height = allocatedHeight > 0
      ? `${allocatedHeight}px`
      : "100%";
    const tasks = this.parseTasks(this.context.parameters.TasksJson.raw);
    const startInput = this.context.parameters.StartDate.raw;
    const endInput = this.context.parameters.EndDate.raw;
    const validTasks = tasks
      .map(task => ({
        start: new Date(task.start).getTime(),
        end: new Date(task.end).getTime()
      }))
      .filter(task =>
        Number.isFinite(task.start) &&
        Number.isFinite(task.end) &&
        task.end > task.start
      );

    const minTask = validTasks.length
      ? Math.min(...validTasks.map(task => task.start))
      : Date.now();

    const maxTask = validTasks.length
      ? Math.max(...validTasks.map(task => task.end))
      : minTask + 86400000;
    this.taskDurationHours = validTasks.length
      ? (validTasks[validTasks.length - 1].end - validTasks[0].start) / 3600000
      : 0;
    if (this.taskDurationHours > 72 && this.mode === "hourly") {
      this.mode = "daily";
    }
    // Add a small amount of space before the earliest task.
    const startPadding =
      this.mode === "hourly" ? 3600000 :
        this.mode === "daily" ? 86400000 :
          this.mode === "monthly" ? 30.4375 * 86400000 :
            91.3125 * 86400000;

    let rangeStart = startInput ? startInput.getTime() : minTask - startPadding;
    let rangeEnd = endInput ? endInput.getTime() : maxTask;

    if (!Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
      rangeEnd = Math.max(maxTask, rangeStart + startPadding);
    }
    if (!isFinite(rangeStart)) rangeStart = minTask;
    if (!isFinite(rangeEnd) || rangeEnd <= rangeStart) rangeEnd = Math.max(maxTask, rangeStart + 86400000);
    // Include task boundaries when supplied range would otherwise hide task bars only by design: the supplied range remains authoritative.

    if (this.mode === "hourly") {
      const startDate = new Date(rangeStart);
      startDate.setMinutes(0, 0, 0);
      rangeStart = startDate.getTime();

      const endDate = new Date(rangeEnd);
      if (
        endDate.getMinutes() !== 0 ||
        endDate.getSeconds() !== 0 ||
        endDate.getMilliseconds() !== 0
      ) {
        endDate.setHours(endDate.getHours() + 1);
        endDate.setMinutes(0, 0, 0);
      }
      rangeEnd = endDate.getTime();
    } else if (this.mode === "daily") {
      const startDate = new Date(rangeStart);
      startDate.setHours(0, 0, 0, 0);
      rangeStart = startDate.getTime();

      const endDate = new Date(rangeEnd);
      const endWasMidnight = endDate.getHours() === 0 && endDate.getMinutes() === 0 && endDate.getSeconds() === 0 && endDate.getMilliseconds() === 0;
      endDate.setHours(0, 0, 0, 0);
      if (!endWasMidnight) endDate.setDate(endDate.getDate() + 1);
      rangeEnd = endDate.getTime();
    } else if (this.mode === "monthly") {
      const startDate = new Date(rangeStart);
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      rangeStart = startDate.getTime();

      const endDate = new Date(rangeEnd);
      const endWasMonthStart = endDate.getDate() === 1 && endDate.getHours() === 0 && endDate.getMinutes() === 0 && endDate.getSeconds() === 0 && endDate.getMilliseconds() === 0;
      endDate.setDate(1);
      endDate.setHours(0, 0, 0, 0);
      if (!endWasMonthStart) endDate.setMonth(endDate.getMonth() + 1);
      rangeEnd = endDate.getTime();
    }
    const totalMs = Math.max(1, rangeEnd - rangeStart);
    const unitMs = this.mode === "hourly" ? 3600000 : this.mode === "daily" ? 86400000 : this.mode === "monthly" ? 30.4375 * 86400000 : 91.3125 * 86400000;

    const dailyBoundaries = [rangeStart];
    if (this.mode === "daily") {
      const dayCursor = new Date(rangeStart);
      while (dayCursor.getTime() < rangeEnd) {
        dayCursor.setDate(dayCursor.getDate() + 1);
        dailyBoundaries.push(Math.min(dayCursor.getTime(), rangeEnd));
      }
    }

    const monthBoundaries = [rangeStart];
    if (this.mode === "monthly" || this.mode === "quarterly") {
      const monthCursor = new Date(rangeStart);
      monthCursor.setDate(1);
      monthCursor.setHours(0, 0, 0, 0);
      monthCursor.setMonth(monthCursor.getMonth() + 1);
      while (monthCursor.getTime() < rangeEnd && monthBoundaries.length < 500) {
        monthBoundaries.push(monthCursor.getTime());
        monthCursor.setMonth(monthCursor.getMonth() + 1);
      }
      monthBoundaries.push(rangeEnd);
    }

    const minLabelWidth = this.mode === "hourly" ? 66 : this.mode === "daily" ? 56 : this.mode === "monthly" ? 120 : 112;

    const taskColumnWidth = 350;
    const availableTimelineWidth = Math.max(
      0,
      this.container.clientWidth - taskColumnWidth
    );

    const maxVisibleTicks = Math.max(
      1,
      Math.floor(availableTimelineWidth / minLabelWidth)
    );

    const tickCount = this.mode === "quarterly"
      ? monthBoundaries.length - 1
      : this.mode === "monthly"
        ? monthBoundaries.length - 1
        : this.mode === "hourly"
          ? Math.max(1, Math.ceil(totalMs / 3600000))
          : this.mode === "daily"
            ? dailyBoundaries.length - 1
            : Math.max(
              1,
              Math.min(
                500,
                Math.ceil(totalMs / unitMs),
                maxVisibleTicks
              )
            );
    const timelineWidth = this.mode === "hourly"
      ? tickCount * minLabelWidth
      : Math.max(availableTimelineWidth, tickCount * minLabelWidth);
    const timelinePosition = (timestamp: number): number => {
      if (this.mode === "daily") {
        const boundedTime = Math.max(rangeStart, Math.min(timestamp, rangeEnd));
        for (let index = 0; index < tickCount; index++) {
          const dayStart = dailyBoundaries[index];
          const dayEnd = dailyBoundaries[index + 1];
          if (boundedTime <= dayEnd) {
            const dayProgress = (boundedTime - dayStart) / (dayEnd - dayStart);
            return (index + dayProgress) / tickCount;
          }
        }
        return 1;
      }
      if (this.mode !== "monthly" && this.mode !== "quarterly") {
        return (timestamp - rangeStart) / totalMs;
      }

      const boundedTime = Math.max(rangeStart, Math.min(timestamp, rangeEnd));
      for (let index = 0; index < tickCount; index++) {
        const monthStart = monthBoundaries[index];
        const monthEnd = monthBoundaries[index + 1];
        if (boundedTime <= monthEnd) {
          const monthProgress = (boundedTime - monthStart) / (monthEnd - monthStart);
          return (index + monthProgress) / tickCount;
        }
      }
      return 1;
    };

    const showSelector = this.context.parameters.ShowViewSelector.raw !== false;

    const prevViewport = this.container.querySelector<HTMLElement>(".tl-viewport");
    const prevScrollTop = prevViewport?.scrollTop ?? 0;
    const prevScrollLeft = prevViewport?.scrollLeft ?? 0;

    this.container.replaceChildren();
    const toolbar = document.createElement("div");
    toolbar.className = "tl-toolbar";
    const heading = document.createElement("div");
    heading.className = "tl-heading";
    heading.textContent = "Timeline";
    toolbar.appendChild(heading);
    const rangeLabel = document.createElement("div");
    rangeLabel.className = "tl-range-label";
    rangeLabel.textContent = `${this.formatDate(new Date(rangeStart))} – ${this.formatDate(new Date(rangeEnd))}`;
    toolbar.appendChild(rangeLabel);
    if (showSelector) {
      const selector = document.createElement("div");
      selector.className = "tl-view-selector";
      (["hourly", "daily", "monthly", "quarterly"] as ViewMode[])
        .filter(mode => mode !== "hourly" || this.taskDurationHours <= 72)
        .forEach(mode => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = mode[0].toUpperCase() + mode.slice(1);
          button.className = `tl-view-button${this.mode === mode ? " is-active" : ""}`;
          button.setAttribute("aria-pressed", String(this.mode === mode));
          button.addEventListener("click", () => { this.mode = mode; this.render(); });
          selector.appendChild(button);
        });
      toolbar.appendChild(selector);
    }
    this.container.appendChild(toolbar);

    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "tl-empty";
      empty.textContent = "Add tasks with description or title, start, and end to TasksJson.";
      this.container.appendChild(empty);
      return;
    }

    const viewport = document.createElement("div");
    viewport.className = "tl-viewport";
    const layout = document.createElement("div");
    layout.className = "tl-layout";
    layout.style.setProperty("--tl-timeline-width", `${timelineWidth}px`);
    layout.style.setProperty("--tl-task-width", `${taskColumnWidth}px`);
    layout.style.width = `${taskColumnWidth + timelineWidth}px`;
    layout.style.boxSizing = "border-box";
    layout.style.position = "relative";
    const leftHead = document.createElement("div");
    leftHead.className = "tl-task-header";
    leftHead.textContent = "Task description";
    const timeHead = document.createElement("div");
    timeHead.className = "tl-time-header";
    timeHead.style.width = "100%";
    timeHead.style.minWidth = "0";
    timeHead.style.boxSizing = "border-box";
    timeHead.style.gridTemplateColumns = `repeat(${tickCount}, minmax(0, 1fr))`;
    if (this.mode === "quarterly") {
      timeHead.style.gridTemplateRows = "24px 24px";
      let quarterStart = 0;
      while (quarterStart < tickCount) {
        const date = new Date(monthBoundaries[quarterStart]);
        const quarter = Math.floor(date.getMonth() / 3);
        const year = date.getFullYear();
        let quarterEnd = quarterStart + 1;
        while (quarterEnd < tickCount) {
          const nextDate = new Date(monthBoundaries[quarterEnd]);
          if (nextDate.getFullYear() !== year || Math.floor(nextDate.getMonth() / 3) !== quarter) break;
          quarterEnd++;
        }
        const quarterHeading = document.createElement("div");
        quarterHeading.className = "tl-quarter-heading";
        quarterHeading.textContent = `Q${quarter + 1} ${year}`;
        quarterHeading.style.gridRow = "1";
        quarterHeading.style.gridColumn = `${quarterStart + 1} / ${quarterEnd + 1}`;
        timeHead.appendChild(quarterHeading);
        quarterStart = quarterEnd;
      }
    }
    for (let i = 0; i < tickCount; i++) {
      const tick = document.createElement("div");
      tick.className = this.mode === "daily"
        ? "tl-time-tick tl-time-tick-daily"
        : this.mode === "hourly"
          ? "tl-time-tick tl-time-tick-hourly"
          : "tl-time-tick";
      const tickTime = this.mode === "quarterly" || this.mode === "monthly"
        ? monthBoundaries[i]
        : this.mode === "daily"
          ? dailyBoundaries[i]
          : this.mode === "hourly"
            ? rangeStart + i * 3600000
            : rangeStart + i * totalMs / tickCount;
      tick.textContent = this.mode === "quarterly"
        ? new Date(tickTime).toLocaleDateString(undefined, { month: "short" })
        : this.tickLabel(tickTime);
      if (this.mode === "quarterly") {
        tick.style.gridRow = "2";
        tick.style.gridColumn = String(i + 1);
      }
      timeHead.appendChild(tick);
    }
    layout.append(leftHead, timeHead);

    tasks.forEach((task, index) => {
      const taskStart = new Date(task.start).getTime();
      const taskEnd = new Date(task.end).getTime();
      const row = document.createElement("div");
      row.className = "tl-row";
      const taskCell = document.createElement("button");
      taskCell.type = "button";
      if (task.status === "Completed") {
        taskCell.className = "tl-task-cell tl-task-completed";
      }
      else {
        taskCell.className = "tl-task-cell";
      }


      taskCell.title = `${task.description || task.title}\n${this.formatDateTime(new Date(taskStart))} – ${this.formatDateTime(new Date(taskEnd))}`;
      taskCell.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".tl-task-edit")) return;
        this.selectTask(task, taskCell);
      });

      const taskName = document.createElement("span");
      taskName.className = "tl-task-name";
      taskName.textContent = task.title || `Task ${index + 1}`;
      taskCell.appendChild(taskName);

      const taskDesc = document.createElement("span");
      taskDesc.className = "tl-task-desc";
      taskDesc.textContent = [task.description, task.status].filter(Boolean).join(" - ");
      const pencil = document.createElement("button");
      pencil.type = "button";
      pencil.className = "tl-task-edit";
      pencil.textContent = "\u270E";
      pencil.title = "Edit task";
      pencil.setAttribute("aria-label", "Edit task");
      pencil.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectTask(task, taskCell, "OnEditTask");
      });
      taskName.prepend(pencil, " ");
      taskCell.appendChild(taskDesc);

      //if (task.status) {
      //  const status = document.createElement("span");
      //  status.className = "tl-task-status";
      //  status.textContent = task.status;
      //  taskCell.appendChild(status);
      //}

      const track = document.createElement("div");
      if (task.status === "Completed") {
        track.className = "tl-track-completed";
      } else {
        track.className = "tl-track";
      }
      track.style.width = "100%";
      track.style.minWidth = "0";
      track.style.boxSizing = "border-box";
      const clippedStart = Math.max(rangeStart, taskStart);
      const clippedEnd = Math.min(rangeEnd, taskEnd);
      if (isFinite(taskStart) && isFinite(taskEnd) && taskEnd > taskStart && clippedEnd > clippedStart) {
        const bar = document.createElement("button");
        bar.type = "button";
        bar.className = "tl-task-bar";
        const barStartPosition = timelinePosition(clippedStart);
        const barEndPosition = timelinePosition(clippedEnd);
        bar.style.left = `${barStartPosition * 100}%`;
        bar.style.width = `${Math.max(0.7, (barEndPosition - barStartPosition) * 100)}%`;
        bar.style.backgroundColor = this.safeColor(task.color, index);
        bar.title = `${task.description || task.title}: ${this.formatDateTime(new Date(taskStart))} – ${this.formatDateTime(new Date(taskEnd))}`;
        bar.setAttribute("aria-label", bar.title);
        bar.addEventListener("click", () => {
          this.selectTask(task, taskCell);
          //alert(bar.title);
        });
        track.appendChild(bar);
      }
      row.append(taskCell, track);
      layout.appendChild(row);
      if (this.selectedTaskId && String(task.id ?? "") === this.selectedTaskId) {
        taskCell.classList.add("is-selected");
        track.classList.add("is-selected");
      }
    });
    const columnGuides = document.createElement("div");
    columnGuides.className = "tl-column-guides";
    columnGuides.style.left = `${taskColumnWidth}px`;
    columnGuides.style.width = `${timelineWidth}px`;
    for (let i = 0; i <= tickCount; i++) {
      const boundary = this.mode === "quarterly" || this.mode === "monthly"
        ? monthBoundaries[i]
        : this.mode === "daily"
          ? dailyBoundaries[i]
          : rangeStart + i * totalMs / tickCount;
      const guide = document.createElement("div");
      guide.className = "tl-column-guide";
      guide.style.left = `${timelinePosition(boundary) * 100}%`;
      columnGuides.appendChild(guide);
    }
    layout.appendChild(columnGuides);
    const now = Date.now();
    if (now >= rangeStart && now <= rangeEnd) {
      const nowLayer = document.createElement("div");
      nowLayer.className = "tl-now-layer";
      nowLayer.style.left = `${taskColumnWidth}px`;
      nowLayer.style.width = `${timelineWidth}px`;
      const nowLine = document.createElement("div");
      nowLine.className = "tl-now-line";
      nowLine.style.left = `${timelinePosition(now) * 100}%`;
      const nowLabel = document.createElement("div");
      nowLabel.className = "tl-now-label";
      nowLabel.textContent = this.formatDateTime(new Date(now));
      nowLine.appendChild(nowLabel);
      nowLayer.appendChild(nowLine);
      layout.appendChild(nowLayer);
    }
    viewport.appendChild(layout);
    this.container.appendChild(viewport);
    viewport.scrollTop = prevScrollTop;
    viewport.scrollLeft = prevScrollLeft;
  }

  private renderSelection(cell: HTMLButtonElement): void {
    this.container.querySelectorAll(".tl-task-cell.is-selected, .tl-track.is-selected, .tl-track-completed.is-selected").forEach(el => el.classList.remove("is-selected"));
    cell.classList.add("is-selected");
    cell.nextElementSibling?.classList.add("is-selected");
  }

  private safeColor(color: string | undefined, index: number): string {
    if (color && (/^#[0-9a-fA-F]{6}$/.test(color) || CSS.supports("color", color.trim()))) {
      return color.trim();
    }
    const palette = ["#2563eb", "#0f766e", "#7c3aed", "#c2410c", "#0369a1", "#be123c"];
    return palette[index % palette.length];
  }

  private tickLabel(ms: number): string {
    const d = new Date(ms);
    if (this.mode === "hourly") return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    if (this.mode === "daily") return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (this.mode === "monthly") return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    return `Q${quarter} ${d.getFullYear()}`;
  }



  private formatDate(d: Date): string { return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  private formatDateTime(d: Date): string { return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
}
