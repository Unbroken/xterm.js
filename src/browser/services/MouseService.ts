/**
 * Copyright (c) 2017 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { addDisposableListener } from '../Dom';
import { IBufferService, IMouseStateService, ICoreService, ILogService, IOptionsService } from '../../common/services/Services';
import { CoreMouseAction, CoreMouseButton, CoreMouseEventType, ICoreMouseEvent, IDisposable } from '../../common/Types';
import { C0 } from '../../common/data/EscapeSequences';
import { DisposableStore, MutableDisposable } from '../../common/Lifecycle';
import { ICoreBrowserService, IMouseCoordsService, IMouseService, IMouseServiceTarget, IRenderService, ISelectionService } from './Services';
import { Gesture, EventType as GestureEventType, IGestureEvent } from '../scrollable/touch';
import { type IMouseWheelEvent, StandardWheelEvent } from '../scrollable/mouseEvent';
import { MouseWheelClassifier } from '../scrollable/scrollableElement';
import { isContextMenuClick } from '../input/Mouse';

/** How long a pause between wheel events ends a gesture, in milliseconds. */
const WHEEL_GESTURE_PAUSE = 1000;

type RequestedMouseEvents = Record<'mouseup' | 'wheel' | 'mousedrag' | 'mousemove', EventListener | null>;

export const enum MouseEventCssClasses {
  ENABLE_MOUSE_EVENTS = 'enable-mouse-events'
}

interface IMouseBindContext {
  readonly target: IMouseServiceTarget;
  readonly focus: () => void;
  readonly requestedEvents: RequestedMouseEvents;
  readonly mouseupListener: MutableDisposable<IDisposable>;
  readonly mousedragListener: MutableDisposable<IDisposable>;
}

export class MouseService implements IMouseService {
  public serviceBrand: undefined;

  private _lastEvent: ICoreMouseEvent | null = null;
  private _isRightPressReported = false;
  /** Ends a reported right press at the next right press anywhere. */
  private readonly _rightPressEndListener = new MutableDisposable<IDisposable>();

  private _isPressReported = false;
  public get isRightPressReported(): boolean { return this._isRightPressReported; }
  public get isPressReported(): boolean { return this._isPressReported; }
  public clearRightPressReported(): void {
    this._isRightPressReported = false;
    this._rightPressEndListener.clear();
  }
  /** Distinguishes a physical mouse wheel from continuous scrolling such as a trackpad's. */
  private _wheelClassifier = new MouseWheelClassifier();
  private _wheelPartialPixels: number = 0;
  private _lastWheelTime: number = 0;
  private _touchScrollAccumulator: number = 0;
  private _altMouseCursor: AltMouseCursorController | undefined;

  constructor(
    @IRenderService private readonly _renderService: IRenderService,
    @IMouseCoordsService private readonly _mouseCoordsService: IMouseCoordsService,
    @IMouseStateService private readonly _mouseStateService: IMouseStateService,
    @ICoreService private readonly _coreService: ICoreService,
    @IBufferService private readonly _bufferService: IBufferService,
    @IOptionsService private readonly _optionsService: IOptionsService,
    @ISelectionService private readonly _selectionService: ISelectionService,
    @ILogService private readonly _logService: ILogService,
    @ICoreBrowserService private readonly _coreBrowserService: ICoreBrowserService
  ) {
  }

  public bindMouse(target: IMouseServiceTarget, register: (disposable: IDisposable) => void, focus: () => void): void {
    const { element, document } = target;

    /**
     * Event listener state handling.
     * We listen to the onProtocolChange event of MouseStateService and put
     * requested listeners in `requestedEvents`. With this the listeners
     * have all bits to do the event listener juggling.
     * Note: 'mousedown' currently is "always on" and not managed
     * by onProtocolChange.
     */
    const requestedEvents: RequestedMouseEvents = {
      mouseup: null,
      wheel: null,
      mousedrag: null,
      mousemove: null
    };
    const mouseupListener = new MutableDisposable<IDisposable>();
    const mousedragListener = new MutableDisposable<IDisposable>();
    register(mouseupListener);
    register(mousedragListener);
    const ctx: IMouseBindContext = { target, focus, requestedEvents, mouseupListener, mousedragListener };
    const eventListeners: Record<'mouseup' | 'wheel' | 'mousedrag' | 'mousemove', EventListener> = {
      mouseup: (ev: Event) => this._handleMouseUp(ctx, ev as MouseEvent),
      wheel: (ev: Event) => this._handleWheel(ctx, ev as WheelEvent),
      mousedrag: (ev: Event) => this._handleMouseDrag(ctx, ev as MouseEvent),
      mousemove: (ev: Event) => this._handleMouseMove(ctx, ev as MouseEvent)
    };
    this._altMouseCursor = new AltMouseCursorController(
      element,
      document,
      () => this._mouseStateService.areMouseEventsActive
        && !!this._optionsService.rawOptions.mouseEventsRequireAlt
    );
    register(this._altMouseCursor);
    register(this._mouseStateService.onProtocolChange(events => {
      this._handleProtocolChange(ctx, eventListeners, events);
    }));
    register(this._optionsService.onSpecificOptionChange('mouseEventsRequireAlt', () => {
      this._syncMouseModeState(element);
      this._altMouseCursor?.sync();
    }));
    // force initial onProtocolChange so we dont miss early mouse requests
    this._mouseStateService.activeProtocol = this._mouseStateService.activeProtocol;

    /**
     * "Always on" event listeners.
     */
    register(addDisposableListener(element, 'mousedown', (ev: MouseEvent) => this._handleMouseDown(ctx, ev)));
    register(this._rightPressEndListener);
    register(addDisposableListener(element, 'wheel', (ev: WheelEvent) => this._handlePassiveWheel(ctx, ev), { passive: false }));
    register(Gesture.addTarget(target.screenElement));
    register(addDisposableListener(target.screenElement, GestureEventType.START, () => this._handleTouchStart()));
    register(addDisposableListener(target.screenElement, GestureEventType.CHANGE, (e: IGestureEvent) => this._handleTouchChange(ctx, e)));
  }

  /** Sends a mouse event to the app, returning whether a report went to it. */
  private _sendEvent(ctx: IMouseBindContext, ev: MouseEvent | WheelEvent): boolean {
    // Every wheel event is a sample of the device, even one without a report
    if (ev.type === 'wheel') {
      this._recordWheelEvent(ev as WheelEvent);
    }

    // Motion with no button held isn't reported while scrolled back, where clicks are the
    // terminal's, since its report would be for the app's live screen and scroll to it
    const buffer = this._bufferService.buffer;
    if (ev.type === 'mousemove' && !ev.buttons && buffer.ydisp !== buffer.ybase) {
      return false;
    }

    // Get mouse coordinates
    const pos = this._mouseCoordsService.getMouseReportCoords(ev as MouseEvent, ctx.target.screenElement);
    if (!pos) {
      return false;
    }

    let but: CoreMouseButton;
    let action: CoreMouseAction | undefined;
    // A wheel event that scrolls several rows sends a report for each
    let reportCount = 1;
    switch ((ev as MouseEvent & { overrideType?: string }).overrideType || ev.type) {
      case 'mousemove':
        action = CoreMouseAction.MOVE;
        if (ev.buttons === undefined) {
          // buttons is not supported on macOS, try to get a value from button instead
          but = CoreMouseButton.NONE;
          if (ev.button !== undefined) {
            but = ev.button < 3 ? ev.button : CoreMouseButton.NONE;
          }
        } else {
          // according to MDN buttons only reports up to button 5 (AUX2)
          but = ev.buttons & 1 ? CoreMouseButton.LEFT :
            ev.buttons & 4 ? CoreMouseButton.MIDDLE :
              ev.buttons & 2 ? CoreMouseButton.RIGHT :
                CoreMouseButton.NONE; // fallback to NONE
        }
        break;
      case 'mouseup':
        action = CoreMouseAction.UP;
        but = ev.button < 3 ? ev.button : CoreMouseButton.NONE;
        break;
      case 'mousedown':
        action = CoreMouseAction.DOWN;
        but = ev.button < 3 ? ev.button : CoreMouseButton.NONE;
        break;
      case 'wheel':
        if (!this._mouseStateService.allowCustomWheelEvent(ev as WheelEvent)) {
          return false;
        }
        const deltaY = (ev as WheelEvent).deltaY;
        if (deltaY === 0) {
          return false;
        }
        const lines = this._consumeWheelEvent(ev as WheelEvent, this._getDisplayedRowHeight());
        if (lines === 0) {
          return false;
        }
        // The direction of the rows scrolled, which pending movement can outweigh
        action = lines < 0 ? CoreMouseAction.UP : CoreMouseAction.DOWN;
        but = CoreMouseButton.WHEEL;
        reportCount = Math.abs(lines);
        break;
      default:
        // dont handle other event types by accident
        return false;
    }

    // exit if we cannot determine valid button/action values
    // do nothing for higher buttons than wheel
    if (action === undefined || but === undefined || but > CoreMouseButton.WHEEL) {
      return false;
    }

    if (but !== CoreMouseButton.WHEEL
      && this._optionsService.rawOptions.mouseEventsRequireAlt
      && this._mouseStateService.areMouseEventsActive
      && !ev.altKey) {
      return false;
    }

    // Alt is only used locally to gate mouse passthrough; do not forward it to the
    // application (e.g. tmux ignores alt-modified mouse reports).
    const stripAltFromReport = but !== CoreMouseButton.WHEEL
      && this._optionsService.rawOptions.mouseEventsRequireAlt
      && this._mouseStateService.areMouseEventsActive;

    let reported = false;
    for (let i = 0; i < reportCount; i++) {
      reported = this._reportMouseEvent({
        col: pos.col,
        row: pos.row,
        x: pos.x,
        y: pos.y,
        button: but,
        action,
        ctrl: ev.ctrlKey,
        alt: stripAltFromReport ? false : ev.altKey,
        shift: ev.shiftKey
      }) === true || reported;
    }
    return reported;
  }

  private _handleMouseUp(ctx: IMouseBindContext, ev: MouseEvent): void {
    this._sendEvent(ctx, ev);
    if (!ev.buttons) {
      // if no other button is held remove global handlers
      ctx.mouseupListener.clear();
      ctx.mousedragListener.clear();
    }
  }

  private _handleWheel(ctx: IMouseBindContext, ev: WheelEvent): false {
    this._sendEvent(ctx, ev);
    ev.preventDefault();
    ev.stopPropagation();
    return false;
  }

  private _handleMouseDrag(ctx: IMouseBindContext, ev: MouseEvent): void {
    // deal only with move while a button is held
    if (ev.buttons) {
      this._sendEvent(ctx, ev);
    }
  }

  private _handleMouseMove(ctx: IMouseBindContext, ev: MouseEvent): void {
    // deal only with move without any button
    if (!ev.buttons) {
      this._sendEvent(ctx, ev);
    }
  }

  private _handleMouseDown(ctx: IMouseBindContext, ev: MouseEvent): void {
    ev.preventDefault();
    ctx.focus();
    this._isPressReported = false;

    // Don't send the mouse button to the pty if mouse events are disabled or
    // if the selection manager is having selection forced (ie. a modifier is
    // held).
    if (!this._mouseStateService.areMouseEventsActive || this._selectionService.shouldForceSelection(ev)) {
      return;
    }

    const isReported = this._sendEvent(ctx, ev);
    this._isPressReported = isReported;
    // Another button's press doesn't end a right click, whose context menu may come on release,
    // while a right press anywhere, such as one that starts outside the terminal and whose context
    // menu comes here, does. Use the element's current document in case it moved to another window.
    if (isContextMenuClick(ev)) {
      this.clearRightPressReported();
      this._isRightPressReported = isReported;
      if (isReported) {
        const { element, document: targetDocument } = ctx.target;
        const listener = addDisposableListener(element.ownerDocument ?? targetDocument, 'mousedown', (e: MouseEvent) => {
          if (isContextMenuClick(e)) {
            this.clearRightPressReported();
          }
        }, true);
        this._rightPressEndListener.value = listener;
        // The terminal may have been disposed while the report was handled
        if (this._rightPressEndListener.value !== listener) {
          listener.dispose();
        }
      }
    }

    // Register additional global handlers which should keep reporting outside
    // of the terminal element.
    // Note: Other emulators also do this for 'mousedown' while a button
    // is held, we currently limit 'mousedown' to the terminal only.
    // Use the element's current document in case it moved to another window after open.
    const { element, document: targetDocument } = ctx.target;
    const listenerDocument = element.ownerDocument ?? targetDocument;
    if (ctx.requestedEvents.mouseup) {
      ctx.mouseupListener.value = addDisposableListener(listenerDocument, 'mouseup', ctx.requestedEvents.mouseup);
    }
    if (ctx.requestedEvents.mousedrag) {
      ctx.mousedragListener.value = addDisposableListener(listenerDocument, 'mousemove', ctx.requestedEvents.mousedrag);
    }
  }

  private _handlePassiveWheel(ctx: IMouseBindContext, ev: WheelEvent): false | void {
    // do nothing, if app side handles wheel itself
    if (ctx.requestedEvents.wheel) {
      return;
    }

    // Only the apps of buffers without scrollback get these wheel events
    if (!this._bufferService.buffer.hasScrollback) {
      this._recordWheelEvent(ev);
    }

    if (!this._mouseStateService.allowCustomWheelEvent(ev)) {
      return false;
    }

    if (!this._bufferService.buffer.hasScrollback) {
      // Convert wheel events into up/down events when the buffer does not have scrollback, this
      // enables scrolling in apps hosted in the alt buffer such as vim or tmux even when mouse
      // events are not enabled. Each row the wheel scrolls sends one sequence.

      // Do nothing if there's no vertical scroll
      const deltaY = ev.deltaY;
      if (deltaY === 0) {
        return false;
      }

      const lines = this._consumeWheelEvent(ev, this._getDisplayedRowHeight());
      if (lines === 0) {
        ev.preventDefault();
        ev.stopPropagation();
        return false;
      }

      // Construct and send sequences, one for each row scrolled
      const sequence = C0.ESC + (this._coreService.decPrivateModes.applicationCursorKeys ? 'O' : '[') + (lines < 0 ? 'A' : 'B');
      for (let i = 0; i < Math.abs(lines); i++) {
        this._coreService.triggerDataEvent(sequence, true);
      }
      ev.preventDefault();
      ev.stopPropagation();
      return false;
    }
  }

  private _handleTouchStart(): void {
    this._touchScrollAccumulator = 0;
  }

  private _handleTouchChange(ctx: IMouseBindContext, e: IGestureEvent): void {
    e.preventDefault();
    e.stopPropagation();

    // When mouse protocol has wheel events active, send as mouse wheel events.
    if (ctx.requestedEvents.wheel) {
      this._handleTouchScrollAsWheel(ctx, e);
      return;
    }

    // When in alt buffer (no scrollback), send up/down key sequences.
    if (!this._bufferService.buffer.hasScrollback) {
      this._handleTouchScrollAsKeys(e);
      return;
    }

    // Normal scrollback: delegate to viewport scrolling when available.
    ctx.target.handleTouchScroll?.(e.translationY);
  }

  private _handleTouchScrollAsKeys(e: IGestureEvent): void {
    const cellHeight = this._renderService?.dimensions.css.cell.height;
    if (!cellHeight) {
      return;
    }

    this._touchScrollAccumulator -= e.translationY;
    const lines = Math.trunc(this._touchScrollAccumulator / cellHeight);
    if (lines === 0) {
      return;
    }

    this._touchScrollAccumulator -= lines * cellHeight;
    const sequence = C0.ESC
      + (this._coreService.decPrivateModes.applicationCursorKeys ? 'O' : '[')
      + (lines < 0 ? 'A' : 'B');
    for (let i = 0; i < Math.abs(lines); i++) {
      this._coreService.triggerDataEvent(sequence, true);
    }
  }

  private _handleTouchScrollAsWheel(ctx: IMouseBindContext, e: IGestureEvent): void {
    const cellHeight = this._renderService?.dimensions.css.cell.height;
    if (!cellHeight) {
      return;
    }

    this._touchScrollAccumulator -= e.translationY;
    const lines = Math.trunc(this._touchScrollAccumulator / cellHeight);
    if (lines === 0) {
      return;
    }

    this._touchScrollAccumulator -= lines * cellHeight;
    const pos = this._mouseCoordsService.getMouseReportCoords(e, ctx.target.screenElement);
    if (!pos) {
      return;
    }

    for (let i = 0; i < Math.abs(lines); i++) {
      this._triggerMouseEvent({
        col: pos.col,
        row: pos.row,
        x: pos.x,
        y: pos.y,
        button: CoreMouseButton.WHEEL,
        action: lines < 0 ? CoreMouseAction.UP : CoreMouseAction.DOWN,
        ctrl: false,
        alt: false,
        shift: false
      });
    }
  }

  public reset(): void {
    this._lastEvent = null;
    this._wheelPartialPixels = 0;
    this._wheelClassifier = new MouseWheelClassifier();
    this._touchScrollAccumulator = 0;
  }

  private _syncMouseModeState(element: HTMLElement): void {
    if (this._mouseStateService.areMouseEventsActive) {
      if (this._optionsService.rawOptions.mouseEventsRequireAlt) {
        this._altMouseCursor?.resetClass();
        this._selectionService.enable();
      } else {
        element.classList.add(MouseEventCssClasses.ENABLE_MOUSE_EVENTS);
        this._selectionService.disable();
      }
    } else {
      element.classList.remove(MouseEventCssClasses.ENABLE_MOUSE_EVENTS);
      this._selectionService.enable();
    }
  }

  private _handleProtocolChange(ctx: IMouseBindContext, eventListeners: Record<'mouseup' | 'wheel' | 'mousedrag' | 'mousemove', EventListener>, events: CoreMouseEventType): void {
    const { element } = ctx.target;
    const { requestedEvents } = ctx;
    // apply global changes on events
    if (events) {
      if (this._optionsService.rawOptions.logLevel === 'debug') {
        this._logService.debug('Binding to mouse events:', this._explainEvents(events));
      }
    } else {
      this._logService.debug('Unbinding from mouse events.');
    }
    this._syncMouseModeState(element);
    this._altMouseCursor?.sync();

    // add/remove handlers from requestedEvents
    if (!(events & CoreMouseEventType.MOVE)) {
      if (requestedEvents.mousemove) {
        element.removeEventListener('mousemove', requestedEvents.mousemove);
      }
      requestedEvents.mousemove = null;
    } else if (!requestedEvents.mousemove) {
      element.addEventListener('mousemove', eventListeners.mousemove);
      requestedEvents.mousemove = eventListeners.mousemove;
    }

    if (!(events & CoreMouseEventType.WHEEL)) {
      if (requestedEvents.wheel) {
        element.removeEventListener('wheel', requestedEvents.wheel);
      }
      requestedEvents.wheel = null;
    } else if (!requestedEvents.wheel) {
      element.addEventListener('wheel', eventListeners.wheel, { passive: false });
      requestedEvents.wheel = eventListeners.wheel;
    }

    if (!(events & CoreMouseEventType.UP)) {
      ctx.mouseupListener.clear();
      requestedEvents.mouseup = null;
    } else {
      requestedEvents.mouseup ??= eventListeners.mouseup;
    }

    if (!(events & CoreMouseEventType.DRAG)) {
      ctx.mousedragListener.clear();
      requestedEvents.mousedrag = null;
    } else {
      requestedEvents.mousedrag ??= eventListeners.mousedrag;
    }
  }

  /**
   * Adds a wheel event to the samples that tell a physical mouse wheel from continuous scrolling,
   * including events without vertical movement, as the viewport's scrolling does. A wheel event
   * after a pause starts a new gesture, which may be with another device. The pause is measured
   * between the times the events happened, which a busy renderer may dispatch together; a time
   * that goes back, as in a window the terminal moved to, starts a new gesture too.
   */
  private _recordWheelEvent(ev: WheelEvent): void {
    const time = ev.timeStamp;
    if (!(time >= this._lastWheelTime && time - this._lastWheelTime <= WHEEL_GESTURE_PAUSE)) {
      this._wheelClassifier = new MouseWheelClassifier();
    }
    this._lastWheelTime = time;
    // Chromium's wheel events also have the wheelDelta properties that it reads
    this._wheelClassifier.acceptStandardWheelEvent(new StandardWheelEvent(ev as unknown as IMouseWheelEvent));
  }

  /**
   * The height of the rows on screen in CSS pixels, which wheel deltas are in: the rendered
   * screen's height, which the renderers round, divided into its rows.
   */
  private _getDisplayedRowHeight(): number | undefined {
    const height = this._renderService?.dimensions?.css?.canvas?.height;
    return height && this._bufferService.rows ? height / this._bufferService.rows : undefined;
  }

  /**
   * Processes a wheel event that an app handles, as mouse wheel reports or arrow keys, into the
   * rows it scrolls, like Alacritty: continuous scrolling, such as a trackpad's, scrolls a row for
   * each row height of movement, keeping the rest for the next event, while each notch of a
   * physical wheel, line or page scrolls one row, fractions kept too. The terminal's own fast
   * scroll modifiers don't apply, since the app gets the modifiers in its reports. An event
   * scrolls at most a screen of rows, and then drops the rest of its movement, even an amount too
   * large for a number.
   */
  private _consumeWheelEvent(ev: WheelEvent, rowHeight?: number): number {
    // Do nothing if it's not a vertical scroll event
    if (ev.deltaY === 0 || ev.shiftKey) {
      return 0;
    }

    // The height of the rows on screen in CSS pixels, which wheel deltas are in
    if (!rowHeight) {
      return 0;
    }

    // Chromium's wheel events also have the wheelDelta properties that it reads
    const standardEvent = new StandardWheelEvent(ev as unknown as IMouseWheelEvent);

    // Everything adds up in pixels, so that how the movement is split into events doesn't
    // matter: a notch of a physical wheel, a line or a page is a row height, fractions included.
    // The sensitivity applies first, so that only an amount of more than a screen can overflow.
    const sensitivity = this._optionsService.rawOptions.scrollSensitivity;
    let pixels: number;
    if (ev.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
      pixels = this._wheelClassifier.isPhysicalMouseWheel()
        ? Math.sign(ev.deltaY) * (Math.abs(standardEvent.deltaY) || 1) * sensitivity * rowHeight
        : ev.deltaY * sensitivity;
    } else {
      pixels = ev.deltaY * sensitivity * rowHeight;
    }
    // An amount that isn't a number sends nothing, and keeps the movement from earlier events
    const totalPixels = this._wheelPartialPixels + pixels;
    if (Number.isNaN(totalPixels)) {
      return 0;
    }
    // With a tolerance for the rounding of fractional row heights, such as at 125% display scaling
    const exactRows = totalPixels / rowHeight;
    const rows = Math.trunc(exactRows + Math.sign(exactRows) * 1e-9);
    const screenRows = this._bufferService.rows;
    if (Math.abs(rows) > screenRows) {
      this._wheelPartialPixels = 0;
      return Math.sign(rows) * screenRows;
    }
    this._wheelPartialPixels = totalPixels - rows * rowHeight;
    return rows;
  }

  /**
   * Triggers a mouse event to be sent.
   *
   * Returns true if the event passed all protocol restrictions and a report
   * was sent, otherwise false. The return value may be used to decide whether
   * the default event action in the browser component should be omitted.
   *
   * Note: The method will change values of the given event object
   * to fulfill protocol and encoding restrictions.
   */
  private _triggerMouseEvent(e: ICoreMouseEvent): boolean {
    return this._reportMouseEvent(e) !== undefined;
  }

  /**
   * Triggers a mouse event, returning undefined when it's dropped, or whether a report went to the
   * app: the default encoding has no report past its last column, and nothing goes to the app while
   * its input is disabled, as a listener of the report could make it.
   */
  private _reportMouseEvent(e: ICoreMouseEvent): boolean | undefined {
    // range check for col/row, written so that NaN fails the check
    if (!(e.col >= 0 && e.col < this._bufferService.cols
      && e.row >= 0 && e.row < this._bufferService.rows)) {
      return undefined;
    }
    // pixel coords are not range checked, but must be finite (SGR_PIXELS)
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) {
      return undefined;
    }

    // filter nonsense combinations of button + action
    if (e.button === CoreMouseButton.WHEEL && e.action === CoreMouseAction.MOVE) {
      return undefined;
    }
    if (e.button === CoreMouseButton.NONE && e.action !== CoreMouseAction.MOVE) {
      return undefined;
    }
    if (e.button !== CoreMouseButton.WHEEL && (e.action === CoreMouseAction.LEFT || e.action === CoreMouseAction.RIGHT)) {
      return undefined;
    }

    // report 1-based coords
    e.col++;
    e.row++;

    // debounce move events at grid or pixel level
    if (e.action === CoreMouseAction.MOVE
      && this._lastEvent
      && this._equalEvents(this._lastEvent, e, this._mouseStateService.isPixelEncoding)
    ) {
      return undefined;
    }

    // apply protocol restrictions
    if (!this._mouseStateService.restrictMouseEvent(e)) {
      return undefined;
    }

    // encode report and send
    const report = this._mouseStateService.encodeMouseEvent(e);
    const reported = !!report && !this._optionsService.rawOptions.disableStdin;
    if (report) {
      if (this._mouseStateService.isDefaultEncoding) {
        this._coreService.triggerBinaryEvent(report);
      } else {
        this._coreService.triggerDataEvent(report, true);
      }
    }

    this._lastEvent = e;
    return reported;
  }

  private _explainEvents(events: CoreMouseEventType): { [event: string]: boolean } {
    return {
      down: !!(events & CoreMouseEventType.DOWN),
      up: !!(events & CoreMouseEventType.UP),
      drag: !!(events & CoreMouseEventType.DRAG),
      move: !!(events & CoreMouseEventType.MOVE),
      wheel: !!(events & CoreMouseEventType.WHEEL)
    };
  }

  private _equalEvents(e1: ICoreMouseEvent, e2: ICoreMouseEvent, pixels: boolean): boolean {
    if (pixels) {
      if (e1.x !== e2.x) return false;
      if (e1.y !== e2.y) return false;
    } else {
      if (e1.col !== e2.col) return false;
      if (e1.row !== e2.row) return false;
    }
    if (e1.button !== e2.button) return false;
    if (e1.action !== e2.action) return false;
    if (e1.ctrl !== e2.ctrl) return false;
    if (e1.alt !== e2.alt) return false;
    if (e1.shift !== e2.shift) return false;
    return true;
  }

}

/**
 * Toggles MouseEventCssClasses.ENABLE_MOUSE_EVENTS on the terminal element while alt is held when
 * `mouseEventsRequireAlt` is active. DOM listeners are only registered while active.
 */
export class AltMouseCursorController implements IDisposable {
  private readonly _listeners = new MutableDisposable<IDisposable>();

  constructor(
    private readonly _element: HTMLElement,
    private readonly _document: Document,
    private readonly _isActive: () => boolean
  ) {
  }

  public dispose(): void {
    this._listeners.dispose();
  }

  public sync(): void {
    this._listeners.clear();

    if (!this._isActive()) {
      return;
    }

    const store = new DisposableStore();
    const syncFromModifier = (ev: KeyboardEvent | MouseEvent): void => this.syncFromModifier(ev);
    store.add(addDisposableListener(this._document, 'keydown', syncFromModifier));
    store.add(addDisposableListener(this._document, 'keyup', syncFromModifier));
    store.add(addDisposableListener(this._element, 'mousemove', syncFromModifier));
    const targetWindow = this._element.ownerDocument?.defaultView;
    if (targetWindow) {
      store.add(addDisposableListener(targetWindow, 'blur', () => {
        if (this._isActive()) {
          this.resetClass();
        }
      }));
    }
    this._listeners.value = store;
  }

  public resetClass(): void {
    this._updateClass(false);
  }

  public syncFromModifier(ev: KeyboardEvent | MouseEvent): void {
    if (!this._isActive()) {
      return;
    }
    this._updateClass(ev.getModifierState('Alt'));
  }

  private _updateClass(altHeld: boolean): void {
    if (altHeld) {
      this._element.classList.add(MouseEventCssClasses.ENABLE_MOUSE_EVENTS);
    } else {
      this._element.classList.remove(MouseEventCssClasses.ENABLE_MOUSE_EVENTS);
    }
  }
}
