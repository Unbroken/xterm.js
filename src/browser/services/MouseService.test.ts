/**
 * Copyright (c) 2019 The xterm.js authors. All rights reserved.
 * @license MIT
 */
import { assert } from 'chai';
import { AltMouseCursorController, MouseEventCssClasses, MouseService } from './MouseService';
import { MouseStateService } from '../../common/services/MouseStateService';
import { CoreMouseAction, CoreMouseButton } from '../../common/Types';
import { IBufferService, ICoreService, ILogService, IOptionsService } from '../../common/services/Services';
import { OptionsService } from '../../common/services/OptionsService';
import { MockCoreBrowserService, MockRenderService, MockSelectionService } from '../TestUtils.test';

function toBytes(s: string | undefined): number[] {
  if (!s) {
    return [];
  }
  const res: number[] = [];
  for (let i = 0; i < s.length; ++i) {
    res.push(s.charCodeAt(i));
  }
  return res;
}

// Minimal mocks for deps that MouseService touches in these tests
const bufferService: IBufferService = {
  buffer: { hasScrollback: true } as any,
  cols: 500,
  rows: 500
} as any;

const optionsService: IOptionsService = {
  rawOptions: {
    logLevel: 'info',
    fastScrollSensitivity: 1,
    scrollSensitivity: 1
  }
} as any;

const logService: ILogService = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
} as any;

class TestSelectionService extends MockSelectionService {
  public enableCount = 0;
  public disableCount = 0;

  public override enable(): void {
    this.enableCount++;
  }

  public override disable(): void {
    this.disableCount++;
  }

  public override shouldForceSelection(): boolean {
    return false;
  }
}

function createTestMouseTargetElement(): HTMLElement {
  const classes = new Set<string>();
  return {
    classList: {
      add: (className: string) => classes.add(className),
      remove: (className: string) => classes.delete(className),
      contains: (className: string) => classes.has(className)
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  } as any;
}

describe('MouseService _triggerMouseEvent', () => {
  let mouseService: MouseService;
  let mouseStateService: MouseStateService;
  let coreService: ICoreService;
  let reports: string[];

  beforeEach(() => {
    reports = [];
    mouseStateService = new MouseStateService();
    coreService = {
      triggerDataEvent: (data: string) => reports.push(data),
      triggerBinaryEvent: (data: string) => reports.push(data),
      decPrivateModes: { applicationCursorKeys: false }
    } as any;

    mouseService = new MouseService(
      new MockRenderService(),
      {
        getMouseReportCoords: (_ev: MouseEvent, _el: HTMLElement) => ({ col: 0, row: 0, x: 0, y: 0 })
      } as any,
      mouseStateService,
      coreService,
      bufferService,
      optionsService,
      new MockSelectionService(),
      logService,
      new MockCoreBrowserService()
    );
  });

  function trigger(e: Parameters<any>[0]): boolean {
    return (mouseService as any)._triggerMouseEvent(e);
  }

  it('NONE', () => {
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.UP }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.MOVE }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.MIDDLE, action: CoreMouseAction.DOWN }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.RIGHT, action: CoreMouseAction.DOWN }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.WHEEL, action: CoreMouseAction.UP }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE }), false);
  });

  it('X10', () => {
    mouseStateService.activeProtocol = 'X10';
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.UP }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.MOVE }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.MIDDLE, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.RIGHT, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.WHEEL, action: CoreMouseAction.UP }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE }), false);
  });

  it('VT200', () => {
    mouseStateService.activeProtocol = 'VT200';
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.UP }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.MOVE }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.MIDDLE, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.RIGHT, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.WHEEL, action: CoreMouseAction.UP }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE }), false);
  });

  it('DRAG', () => {
    mouseStateService.activeProtocol = 'DRAG';
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.UP }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.MOVE }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.MIDDLE, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.RIGHT, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.WHEEL, action: CoreMouseAction.UP }), true);
  });

  it('ANY', () => {
    mouseStateService.activeProtocol = 'ANY';
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.UP }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.MOVE }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.MIDDLE, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.RIGHT, action: CoreMouseAction.DOWN }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.WHEEL, action: CoreMouseAction.UP }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE }), true);
    // should not report in any case
    // invalid button + action combinations
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.WHEEL, action: CoreMouseAction.MOVE }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.DOWN }), false);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.UP }), false);
    // invalid coords
    assert.equal(trigger({ col: -1, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), false);
    assert.equal(trigger({ col: 500, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), false);
    assert.equal(trigger({ col: 0, row: -1, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), false);
    assert.equal(trigger({ col: 0, row: 500, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), false);
  });

  describe('non-finite coords', () => {
    const nonFiniteCoords = [
      { col: NaN, row: 0, x: 0, y: 0 },
      { col: 0, row: NaN, x: 0, y: 0 },
      { col: Infinity, row: 0, x: 0, y: 0 },
      { col: 0, row: -Infinity, x: 0, y: 0 },
      { col: 0, row: 0, x: NaN, y: 0 },
      { col: 0, row: 0, x: 0, y: Infinity }
    ];
    for (const encoding of ['DEFAULT', 'SGR', 'SGR_PIXELS']) {
      it(`${encoding} encoding`, () => {
        mouseStateService.activeProtocol = 'ANY';
        mouseStateService.activeEncoding = encoding;
        for (const coords of nonFiniteCoords) {
          assert.equal(trigger({ ...coords, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), false);
          assert.equal(trigger({ ...coords, button: CoreMouseButton.LEFT, action: CoreMouseAction.UP }), false);
          assert.equal(trigger({ ...coords, button: CoreMouseButton.WHEEL, action: CoreMouseAction.UP }), false);
        }
        assert.deepEqual(reports, []);
      });
    }
  });

  describe('coords', () => {
    it('DEFAULT encoding', () => {
      mouseStateService.activeProtocol = 'ANY';
      for (let i = 0; i < bufferService.cols; ++i) {
        assert.equal(trigger({ col: i, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), true);
        if (i > 222) {
          // suppress mouse reports if we are out of addressable range (max. 222)
          assert.deepEqual(toBytes(reports.pop()), []);
        } else {
          assert.deepEqual(toBytes(reports.pop()), [0x1b, 0x5b, 0x4d, 0x20, i + 33, 0x21]);
        }
      }
    });

    it('SGR encoding', () => {
      mouseStateService.activeProtocol = 'ANY';
      mouseStateService.activeEncoding = 'SGR';
      for (let i = 0; i < bufferService.cols; ++i) {
        assert.equal(trigger({ col: i, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), true);
        assert.deepEqual(reports.pop(), `\x1b[<0;${i + 1};1M`);
      }
    });

    it('SGR_PIXELS encoding', () => {
      mouseStateService.activeProtocol = 'ANY';
      mouseStateService.activeEncoding = 'SGR_PIXELS';
      for (let i = 0; i < 500; ++i) {
        assert.equal(trigger({ col: 0, row: 0, x: i, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN }), true);
        assert.deepEqual(reports.pop(), `\x1b[<0;${i};0M`);
      }
    });
  });

  it('eventCodes with modifiers (DEFAULT encoding)', () => {
    // TODO: implement AUX button tests
    mouseStateService.activeProtocol = 'ANY';
    mouseStateService.activeEncoding = 'DEFAULT';
    // all buttons + down + no modifer
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.DOWN, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.MIDDLE, action: CoreMouseAction.DOWN, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.RIGHT, action: CoreMouseAction.DOWN, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.WHEEL, action: CoreMouseAction.DOWN, ctrl: false, alt: false, shift: false }), true);
    assert.deepEqual(reports, ['\x1b[M !!', '\x1b[M!!!', '\x1b[M"!!', '\x1b[Ma!!']);
    reports = [];

    // all buttons + up + no modifier
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.UP, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.MIDDLE, action: CoreMouseAction.UP, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.RIGHT, action: CoreMouseAction.UP, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.WHEEL, action: CoreMouseAction.UP, ctrl: false, alt: false, shift: false }), true);
    assert.deepEqual(reports, ['\x1b[M#!!', '\x1b[M#!!', '\x1b[M#!!', '\x1b[M`!!']);
    reports = [];

    // all buttons + move + no modifier
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.LEFT, action: CoreMouseAction.MOVE, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.MIDDLE, action: CoreMouseAction.MOVE, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.RIGHT, action: CoreMouseAction.MOVE, ctrl: false, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE, ctrl: false, alt: false, shift: false }), true);
    assert.deepEqual(reports, ['\x1b[M@!!', '\x1b[MA!!', '\x1b[MB!!', '\x1b[MC!!']);
    reports = [];

    // button none + move + modifiers
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE, ctrl: true, alt: false, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE, ctrl: false, alt: true, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE, ctrl: false, alt: false, shift: true }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE, ctrl: true, alt: true, shift: false }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE, ctrl: false, alt: true, shift: true }), true);
    assert.equal(trigger({ col: 0, row: 0, x: 0, y: 0, button: CoreMouseButton.NONE, action: CoreMouseAction.MOVE, ctrl: true, alt: true, shift: true }), true);
    assert.deepEqual(reports, ['\x1b[MS!!', '\x1b[MK!!', '\x1b[MG!!', '\x1b[M[!!', '\x1b[MO!!', '\x1b[M_!!']);
    reports = [];
  });
});

describe('MouseService mouseEventsRequireAlt', () => {
  it('should update selection state and cursor class when toggled while mouse events are active', () => {
    const mouseStateService = new MouseStateService();
    const optionsService = new OptionsService({});
    const selectionService = new TestSelectionService();
    const mouseService = new MouseService(
      new MockRenderService(),
      {
        getMouseReportCoords: (_ev: MouseEvent, _el: HTMLElement) => ({ col: 0, row: 0, x: 0, y: 0 })
      } as any,
      mouseStateService,
      {
        triggerDataEvent: () => {},
        triggerBinaryEvent: () => {},
        decPrivateModes: { applicationCursorKeys: false }
      } as any,
      bufferService,
      optionsService,
      selectionService,
      logService,
      new MockCoreBrowserService()
    );
    const element = createTestMouseTargetElement();
    const screenElement = createTestMouseTargetElement();
    const document = {
      addEventListener: () => {},
      removeEventListener: () => {}
    } as any;

    mouseService.bindMouse({
      element,
      screenElement,
      document
    }, disposable => disposable, () => {});

    mouseStateService.activeProtocol = 'ANY';
    assert.isTrue(element.classList.contains(MouseEventCssClasses.ENABLE_MOUSE_EVENTS));
    assert.equal(selectionService.disableCount, 1);

    optionsService.options.mouseEventsRequireAlt = true;
    assert.isFalse(element.classList.contains(MouseEventCssClasses.ENABLE_MOUSE_EVENTS));
    assert.equal(selectionService.enableCount, 2);

    optionsService.options.mouseEventsRequireAlt = false;
    assert.isTrue(element.classList.contains(MouseEventCssClasses.ENABLE_MOUSE_EVENTS));
    assert.equal(selectionService.disableCount, 2);
  });

  it('should strip alt modifier from forwarded mouse reports', () => {
    const mouseStateService = new MouseStateService();
    mouseStateService.activeProtocol = 'ANY';
    mouseStateService.activeEncoding = 'SGR';
    const optionsService = new OptionsService({ mouseEventsRequireAlt: true });
    const reports: string[] = [];
    const mouseService = new MouseService(
      new MockRenderService(),
      {
        getMouseReportCoords: () => ({ col: 0, row: 0, x: 0, y: 0 })
      } as any,
      mouseStateService,
      {
        triggerDataEvent: (data: string) => reports.push(data),
        triggerBinaryEvent: () => {},
        decPrivateModes: { applicationCursorKeys: false }
      } as any,
      bufferService,
      optionsService,
      new TestSelectionService(),
      logService,
      new MockCoreBrowserService()
    );
    const ctx = {
      target: {
        screenElement: createTestMouseTargetElement()
      },
      requestedEvents: {}
    } as any;

    const sent = (mouseService as any)._sendEvent(ctx, {
      type: 'mousedown',
      button: 0,
      altKey: true,
      ctrlKey: false,
      shiftKey: false
    } as MouseEvent);

    assert.isTrue(sent);
    assert.deepEqual(reports, ['\x1b[<0;1;1M']);
  });

  it('should toggle enable-mouse-events class when alt modifier changes', () => {
    const element = createTestMouseTargetElement();
    const altMouseCursor = new AltMouseCursorController(element, {
      addEventListener: () => {},
      removeEventListener: () => {}
    } as any, () => true);

    const sync = (altHeld: boolean) => altMouseCursor.syncFromModifier({
      getModifierState: (key: string) => key === 'Alt' && altHeld
    } as KeyboardEvent);

    assert.isFalse(element.classList.contains(MouseEventCssClasses.ENABLE_MOUSE_EVENTS));
    sync(true);
    assert.isTrue(element.classList.contains(MouseEventCssClasses.ENABLE_MOUSE_EVENTS));
    sync(false);
    assert.isFalse(element.classList.contains(MouseEventCssClasses.ENABLE_MOUSE_EVENTS));
  });
});

describe('MouseService multi-window', () => {
  interface IRecordingDocument {
    doc: Document;
    added: string[];
    removed: string[];
    listeners: { [type: string]: EventListener[] };
  }

  function createRecordingDocument(): IRecordingDocument {
    const added: string[] = [];
    const removed: string[] = [];
    const listeners: { [type: string]: EventListener[] } = {};
    const doc = {
      addEventListener: (type: string, listener: EventListener) => {
        added.push(type);
        (listeners[type] ??= []).push(listener);
      },
      removeEventListener: (type: string) => removed.push(type)
    } as any;
    return { doc, added, removed, listeners };
  }

  it('should manage protocol mouseup/mousemove listeners on the element\'s current document, not the document the terminal was opened with', () => {
    const mouseStateService = new MouseStateService();
    const optionsService = new OptionsService({});
    const mouseService = new MouseService(
      new MockRenderService(),
      {
        getMouseReportCoords: () => ({ col: 0, row: 0, x: 0, y: 0 })
      } as any,
      mouseStateService,
      {
        triggerDataEvent: () => {},
        triggerBinaryEvent: () => {},
        decPrivateModes: { applicationCursorKeys: false }
      } as any,
      bufferService,
      optionsService,
      new TestSelectionService(),
      logService,
      new MockCoreBrowserService()
    );

    // Simulate a terminal that was opened with one document but whose element now lives in
    // another document (eg. it was moved to a child window)
    const openDocument = createRecordingDocument();
    const childDocument = createRecordingDocument();
    const elementListeners: { [type: string]: EventListener[] } = {};
    const element = {
      classList: {
        add: () => {},
        remove: () => {},
        contains: () => false
      },
      addEventListener: (type: string, listener: EventListener) => {
        (elementListeners[type] ??= []).push(listener);
      },
      removeEventListener: () => {},
      ownerDocument: childDocument.doc
    } as any;

    mouseService.bindMouse({
      element,
      screenElement: createTestMouseTargetElement(),
      document: openDocument.doc
    }, disposable => disposable, () => {});
    mouseStateService.activeProtocol = 'ANY';

    elementListeners['mousedown'][0]({
      type: 'mousedown',
      button: 0,
      buttons: 1,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
      preventDefault: () => {}
    } as any);
    assert.deepEqual(childDocument.added, ['mouseup', 'mousemove']);
    assert.deepEqual(openDocument.added, []);

    childDocument.listeners['mouseup'][0]({
      type: 'mouseup',
      button: 0,
      buttons: 0,
      altKey: false,
      ctrlKey: false,
      shiftKey: false
    } as any);
    assert.deepEqual(childDocument.removed, ['mouseup', 'mousemove']);
    assert.deepEqual(openDocument.removed, []);
  });
});

describe('MouseService wheel', () => {
  let mouseService: MouseService;
  let mouseStateService: MouseStateService;
  let reports: string[];
  let hasScrollback: boolean;
  const originalWheelEvent = (globalThis as any).WheelEvent;

  // Rows 17px high
  const renderService = new MockRenderService();
  renderService.dimensions.css.cell.height = 17;
  renderService.dimensions.css.canvas.height = 17 * 24;
  renderService.dimensions.device.cell.height = 34;
  const coreBrowserService = new MockCoreBrowserService();
  coreBrowserService.dpr = 2;

  beforeEach(() => {
    (globalThis as any).WheelEvent = originalWheelEvent ?? { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 };
    reports = [];
    hasScrollback = false;
    mouseStateService = new MouseStateService();
    mouseService = new MouseService(
      renderService,
      { getMouseReportCoords: () => ({ col: 0, row: 0, x: 0, y: 0 }) } as any,
      mouseStateService,
      {
        triggerDataEvent: (data: string) => reports.push(data),
        triggerBinaryEvent: (data: string) => reports.push(data),
        decPrivateModes: { applicationCursorKeys: false }
      } as any,
      { buffer: { get hasScrollback() { return hasScrollback; } }, cols: 80, rows: 24 } as any,
      optionsService,
      new MockSelectionService(),
      logService,
      coreBrowserService
    );
  });

  afterEach(() => {
    (globalThis as any).WheelEvent = originalWheelEvent;
  });

  function wheel(deltaY: number, options: { deltaMode?: number, ctrlKey?: boolean, timeStamp?: number } = {}): WheelEvent {
    return { type: 'wheel', deltaX: 0, deltaY, deltaMode: options.deltaMode ?? 0, timeStamp: options.timeStamp ?? 0, shiftKey: false, ctrlKey: options.ctrlKey ?? false, altKey: false, preventDefault: () => {}, stopPropagation: () => {} } as any;
  }

  /** The rows that a wheel event scrolls in an app, which also tells the device from its samples. */
  function consume(ev: WheelEvent, rowHeight: number): number {
    (mouseService as any)._recordWheelEvent(ev);
    return (mouseService as any)._consumeWheelEvent(ev, rowHeight);
  }

  /** The rows that wheel events scroll, starting without a partial row from earlier events. */
  function rowsOf(...events: WheelEvent[]): number[] {
    mouseService.reset();
    return events.map(ev => consume(ev, 17));
  }

  it('scrolls a row for each row height a trackpad moves, keeping the rest for the next event', () => {
    assert.deepEqual({
      // 10 events of 5px: 50px is 2 rows of 17px, with 16px left over
      even: rowsOf(...Array.from({ length: 10 }, () => wheel(5))),
      // The pixels are added up before they're divided into rows
      split: rowsOf(wheel(1), wheel(2), wheel(7), wheel(7))
    }, {
      even: [0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
      split: [0, 0, 0, 1]
    });
  });

  it('scrolls a row for each notch of a physical wheel, line or page', () => {
    assert.deepEqual({
      // Chromium's notches are 40px, and an event can carry several
      notches: rowsOf(wheel(40), wheel(40), wheel(120)),
      lines: rowsOf(wheel(2, { deltaMode: 1 })),
      // Half notches add up with whole ones
      fractions: rowsOf(wheel(1, { deltaMode: 1 }), wheel(0.5, { deltaMode: 1 }), wheel(1, { deltaMode: 1 }), wheel(0.5, { deltaMode: 1 })),
      // Pages coalesced into one event each count
      pages: rowsOf(wheel(1, { deltaMode: 2 }), wheel(2, { deltaMode: 2 }))
    }, {
      notches: [1, 1, 3],
      lines: [2],
      fractions: [1, 0, 1, 1],
      pages: [1, 2]
    });
  });

  it('scrolls whole rows at fractional display scales', () => {
    mouseService.reset();
    // Rows of 17.6px, the rendered height of 22 device pixels at 125%, which a line count rounds
    // back to almost 3
    assert.deepEqual(consume(wheel(3, { deltaMode: 1 }), 17.6), 3);
  });

  it('tells a trackpad by its horizontal movement too', () => {
    // A horizontal trackpad sample, then 40px down: 2 rows of 17px, not a notch
    mouseService.reset();
    mouseStateService.activeProtocol = 'VT200';
    (mouseService as any)._sendEvent({ target: { screenElement: {} } }, { ...wheel(0), deltaX: 5 });
    (mouseService as any)._sendEvent({ target: { screenElement: {} } }, wheel(40));
    assert.equal(reports.length, 2);
  });

  it('forgets the wheel events before a pause when telling a physical wheel from a trackpad', () => {
    // A diagonal trackpad movement, then a 40px notch: by the times the events happened, which may
    // be dispatched together, two seconds later, half a second later, and earlier, as in another
    // window, even by less than the pause
    const after = (time: number) => {
      mouseService.reset();
      consume({ ...wheel(5, { timeStamp: 5000 }), deltaX: 5 }, 17);
      return consume(wheel(40, { timeStamp: time }), 17);
    };
    assert.deepEqual(
      { pause: after(7000), gesture: after(5500), earlier: after(1000), slightlyEarlier: after(4500) },
      { pause: 1, gesture: 2, earlier: 1, slightlyEarlier: 1 }
    );
  });

  it('forgets the wheel events before a reset when telling a physical wheel from a trackpad', () => {
    // A diagonal trackpad movement, then a reset of the terminal, then a 40px notch
    consume({ ...wheel(5), deltaX: 5 }, 17);
    assert.deepEqual(rowsOf(wheel(40)), [1]);
  });

  it('keeps the fraction of lines scrolled at a lower sensitivity for the next event', () => {
    const sensitivity = optionsService.rawOptions.scrollSensitivity;
    optionsService.rawOptions.scrollSensitivity = 0.5;
    try {
      assert.deepEqual(rowsOf(wheel(3, { deltaMode: 1 }), wheel(3, { deltaMode: 1 })), [1, 2]);
    } finally {
      optionsService.rawOptions.scrollSensitivity = sensitivity;
    }
  });

  it('scrolls at most a screen of rows for an event, dropping the rest, and none for an amount that isn\'t a number', () => {
    const sensitivity = optionsService.rawOptions.scrollSensitivity;
    try {
      // A screen and a half, then 5px: nothing of the half screen is kept
      const capped = rowsOf(wheel(17 * 36 + 8), wheel(5));
      // A billion lines with 17.6px rows, which divide back into slightly fewer, then 5px
      mouseService.reset();
      const billion = [consume(wheel(1e9, { deltaMode: 1 }), 17.6), consume(wheel(5), 17.6)];
      // Almost 25 lines, which count as 25 and so are capped, then almost a line, which is one
      const rounded = rowsOf(wheel(25 - 0.75e-9, { deltaMode: 1 }), wheel(1 - 0.75e-9, { deltaMode: 1 }));
      // Amounts too large for a number, from the line's height or from the sensitivity, the last
      // with 8px pending, then 9px
      const huge = rowsOf(wheel(1e308, { deltaMode: 1 }));
      optionsService.rawOptions.scrollSensitivity = 0.1;
      huge.push(...rowsOf(wheel(1e308, { deltaMode: 1 })));
      mouseService.reset();
      optionsService.rawOptions.scrollSensitivity = 1;
      huge.push(consume(wheel(8), 17));
      optionsService.rawOptions.scrollSensitivity = 1e308;
      huge.push(consume(wheel(-35), 17));
      optionsService.rawOptions.scrollSensitivity = 1;
      huge.push(consume(wheel(9), 17));
      // A huge number of lines at a tiny sensitivity, which is 2 rows
      optionsService.rawOptions.scrollSensitivity = 2e-308;
      const tiny = rowsOf(wheel(1e308, { deltaMode: 1 }));
      optionsService.rawOptions.scrollSensitivity = 1;
      // 8px pending stays through an amount that isn't a number, and 9px more make a row
      mouseService.reset();
      const kept = [consume(wheel(8), 17), consume(wheel(NaN), 17), consume(wheel(9), 17)];
      assert.deepEqual(
        { capped, billion, rounded, huge, tiny, kept },
        { capped: [24, 0], billion: [24, 0], rounded: [24, 1], huge: [24, 24, 0, -24, 0], tiny: [2], kept: [0, 0, 1] }
      );
    } finally {
      optionsService.rawOptions.scrollSensitivity = sensitivity;
    }
  });

  it('tells a trackpad by a sample that sends no report', () => {
    // A horizontal trackpad sample where the mouse has no position, then 40px down: 2 rows of 17px
    mouseService.reset();
    mouseStateService.activeProtocol = 'VT200';
    const coords = (mouseService as any)._mouseCoordsService;
    const getMouseReportCoords = coords.getMouseReportCoords;
    coords.getMouseReportCoords = () => undefined;
    try {
      (mouseService as any)._sendEvent({ target: { screenElement: {} } }, { ...wheel(0), deltaX: 5 });
    } finally {
      coords.getMouseReportCoords = getMouseReportCoords;
    }
    (mouseService as any)._sendEvent({ target: { screenElement: {} } }, wheel(40));
    assert.equal(reports.length, 2);
  });

  it('sends a wheel report for each row a wheel event scrolls, without multiplying it for modifiers', () => {
    mouseStateService.activeProtocol = 'VT200';
    (mouseService as any)._sendEvent({ target: { screenElement: {} } }, wheel(35));
    const plain = reports.length;
    reports = [];
    // VS Code's default fast scroll multiplier
    const fastScrollSensitivity = optionsService.rawOptions.fastScrollSensitivity;
    optionsService.rawOptions.fastScrollSensitivity = 5;
    try {
      (mouseService as any)._sendEvent({ target: { screenElement: {} } }, wheel(35, { ctrlKey: true }));
    } finally {
      optionsService.rawOptions.fastScrollSensitivity = fastScrollSensitivity;
    }
    assert.deepEqual({ plain, ctrl: reports.length }, { plain: 2, ctrl: 2 });
  });

  it('scrolls in the direction of the rows scrolled, which pending movement can outweigh', () => {
    // 20px down is pending with 24px rows, which become 12px rows before 1px up
    renderService.dimensions.css.canvas.height = 24 * 24;
    (mouseService as any)._handlePassiveWheel({ requestedEvents: {} }, wheel(20));
    renderService.dimensions.css.canvas.height = 12 * 24;
    try {
      (mouseService as any)._handlePassiveWheel({ requestedEvents: {} }, wheel(-1));
    } finally {
      renderService.dimensions.css.canvas.height = 17 * 24;
    }
    assert.deepEqual(reports, ['\x1b[B']);
  });

  it('counts rows by their rendered height', () => {
    // At 125% with 22 device pixel cells, the renderer rounds the 24 rows to a 422px screen, while
    // the WebGL renderer's cell height stays 17.6px
    renderService.dimensions.css.canvas.height = 422;
    renderService.dimensions.css.cell.height = 17.6;
    try {
      (mouseService as any)._handlePassiveWheel({ requestedEvents: {} }, wheel(422));
    } finally {
      renderService.dimensions.css.canvas.height = 17 * 24;
      renderService.dimensions.css.cell.height = 17;
    }
    assert.equal(reports.length, 24);
  });

  it('sends an arrow key for each row a wheel event scrolls without scrollback or mouse reporting', () => {
    (mouseService as any)._handlePassiveWheel({ requestedEvents: {} }, wheel(-35));
    assert.deepEqual(reports, ['\x1b[A', '\x1b[A']);
  });
});
