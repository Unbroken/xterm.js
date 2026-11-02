/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */
import { test } from '@playwright/test';
import { deepStrictEqual, ok, strictEqual } from 'assert';
import { createTestContext, ITestContext, openTerminal } from './TestUtils';
import { IRenderDimensions } from '../../src/browser/renderer/shared/Types';

let ctx: ITestContext;
test.beforeAll(async ({ browser }) => {
  ctx = await createTestContext(browser);
  await openTerminal(ctx);
});
test.afterAll(async () => await ctx.page.close());

test.describe('RenderService dimensions after dispose', () => {
  test('dimensions does not throw after dispose', async () => {
    // Cold read: openTerminal does not write, so nothing on the open path (including
    // _syncTextArea) touches RenderService.dimensions. Sample the live renderer directly,
    // dispose, then read the getter. A 0×0 fallback or a TypeError must fail (#6070).
    await openTerminal(ctx);
    const size: { width: number, height: number } = await ctx.page.evaluate(`
      (() => {
        const dimensions = window.term._core._renderService._renderer.value.dimensions;
        return { width: dimensions.css.canvas.width, height: dimensions.css.canvas.height };
      })()
    `);
    ok(size.width > 0);
    ok(size.height > 0);

    await ctx.page.evaluate(`window.term.dispose()`);
    const dimensions: IRenderDimensions = await ctx.page.evaluate(`window.term._core._renderService.dimensions`);
    strictEqual(dimensions.css.canvas.width, size.width);
    strictEqual(dimensions.css.canvas.height, size.height);
    ok(dimensions.css.canvas.width > 0);
    ok(dimensions.css.canvas.height > 0);
    ok(dimensions.css.cell.width > 0);

    // leave the page in a clean state for the next test
    await openTerminal(ctx);
  });

  test('a mouseup/mousemove reaching a disposed terminal mid-drag does not throw', async () => {
    // Companion end-to-end guard for the listener-lifecycle half of the same reports
    // (xtermjs/xterm.js#6070, #6086): document-level mouseup/mousemove listeners installed for
    // mouse reporting must not survive dispose() mid-drag. Fixed by #6019 registering them as
    // MutableDisposables; this exercises that path directly rather than the getter above.
    const errors: string[] = [];
    const onPageError = (e: Error): number => errors.push(e.message);
    ctx.page.on('pageerror', onPageError);

    try {
      // enable mouse-drag reporting (DECSET 1002), same as an app like vim/tmux would
      await ctx.proxy.write('\x1b[?1002h');

      const rect: { left: number, top: number, width: number, height: number } = await ctx.page.evaluate(`
        window.term.element.getBoundingClientRect().toJSON()
      `);
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      await ctx.page.mouse.move(x, y);
      await ctx.page.mouse.down({ button: 'left' });

      // dispose while the button is still held, before the paired mouseup can self-remove
      // the document-level listeners
      await ctx.page.evaluate(`window.term.dispose()`);

      // the release the disposed terminal never got to see
      await ctx.page.mouse.up({ button: 'left' });
      // and a move for good measure, covering the mousemove listener too
      await ctx.page.mouse.move(x + 10, y + 10);
    } finally {
      ctx.page.off('pageerror', onPageError);
    }

    deepStrictEqual(errors, []);

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });
});

test.describe('RenderService synchronized output', () => {
  test('renders at the end of an update without handling its write again', async () => {
    await openTerminal(ctx);
    const result: { line: string, renders: number } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        // A listener that resizes the terminal makes it handle the pending writes right away
        let renders = 0;
        const rows = term.rows;
        const listener = term.onRender(() => {
          renders++;
          term.resize(term.cols, renders % 2 ? rows + 1 : rows);
        });
        await write('A');
        await frame();
        // The frame of the update is skipped, so the terminal renders when the update ends
        await write('\\x1b[?2026hB');
        await frame();
        await frame();
        await write('\\x1b[?2026lC');
        await frame();
        listener.dispose();
        return { line: term.buffer.active.getLine(0).translateToString(true), renders };
      })()
    `);
    strictEqual(result.line, 'ABC');
    ok(result.renders > 0);

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('renders at the end of an update with a joiner that resizes without handling its write again', async () => {
    await openTerminal(ctx);
    const result: { line: string } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        const rows = term.rows;
        let resized = false;
        await write('A');
        await frame();
        await write('\\x1b[?2026hB');
        await frame();
        await frame();
        // The joiner runs while the frame at the end of the update is drawn, inside the parser
        const joiner = term.registerCharacterJoiner(() => {
          if (!resized) {
            resized = true;
            term.resize(term.cols, rows + 1);
          }
          return [];
        });
        await write('\\x1b[?2026lC');
        await frame();
        term.deregisterCharacterJoiner(joiner);
        term.resize(term.cols, rows);
        return { line: term.buffer.active.getLine(0).translateToString(true) };
      })()
    `);
    strictEqual(result.line, 'ABC');

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('renders at the end of an update while an async handler of its write is pending', async () => {
    await openTerminal(ctx);
    const result: { line: string, errors: string[] } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const errors = [];
        const onError = e => errors.push(String(e.message ?? e));
        window.addEventListener('error', onError);
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        const handler = term.parser.registerOscHandler(1337, () => Promise.resolve(true));
        let renders = 0;
        const rows = term.rows;
        const listener = term.onRender(() => {
          renders++;
          try {
            term.resize(term.cols, renders % 2 ? rows + 1 : rows);
          } catch (e) {
            errors.push(String(e.message ?? e));
          }
        });
        await write('A');
        await frame();
        await write('\x1b[?2026hB');
        await frame();
        await frame();
        // The handler pauses the parser on the write that ends the update
        await write('\x1b[?2026l\x1b]1337;x\x07C');
        await frame();
        await write('D');
        await frame();
        listener.dispose();
        handler.dispose();
        window.removeEventListener('error', onError);
        return { line: term.buffer.active.getLine(0).translateToString(true), errors };
      })()
    `);
    deepStrictEqual(result, { line: 'ABCD', errors: [] });

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('renders at the end of an update when the next one starts while an async handler is pending', async () => {
    await openTerminal(ctx);
    const result: { line: string, errors: string[] } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const errors = [];
        const onError = e => errors.push(String(e.message ?? e));
        window.addEventListener('error', onError);
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        // A handler that keeps the parser waiting across animation frames
        const handler = term.parser.registerOscHandler(1337, () => new Promise(resolve => setTimeout(() => resolve(true), 100)));
        let renders = 0;
        const rows = term.rows;
        const listener = term.onRender(() => {
          renders++;
          try {
            term.resize(term.cols, renders % 2 ? rows + 1 : rows);
          } catch (e) {
            errors.push(String(e.message ?? e));
          }
        });
        await write('A');
        await frame();
        await write('\x1b[?2026hB');
        await frame();
        await frame();
        // The update ends and the next one starts before the frame that fires the render events
        await write('\x1b[?2026l\x1b[?2026hC\x1b]1337;x\x07D\x1b[?2026l');
        await frame();
        await write('E');
        await frame();
        listener.dispose();
        handler.dispose();
        window.removeEventListener('error', onError);
        return { line: term.buffer.active.getLine(0).translateToString(true), errors };
      })()
    `);
    deepStrictEqual(result, { line: 'ABCDE', errors: [] });

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('draws an update that ends in a write of its own once', async () => {
    await openTerminal(ctx);
    const result: { line: string, renders: number } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        await write('A');
        await frame();
        await write('\\x1b[?2026hB');
        await frame();
        await frame();
        let renders = 0;
        const listener = term.onRender(() => renders++);
        // The update ends in this write, which changes nothing after that
        await write('\\x1b[?2026l');
        await frame();
        await frame();
        listener.dispose();
        return { line: term.buffer.active.getLine(0).translateToString(true), renders };
      })()
    `);
    deepStrictEqual(result, { line: 'AB', renders: 1 });

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('draws the cursor moving, hiding or changing its style after an update ends in the same write', async () => {
    await openTerminal(ctx);
    const result: { moved: string | undefined, hidden: boolean, style: string | undefined, renders: number } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        // The text before the cursor in its row, or undefined without a cursor
        const beforeCursor = () => {
          const cursor = document.querySelector('.xterm-rows .xterm-cursor');
          if (!cursor) {
            return undefined;
          }
          let text = '';
          for (let node = cursor.previousSibling; node; node = node.previousSibling) {
            text = node.textContent + text;
          }
          return text;
        };
        const update = async after => {
          await write('\\x1b[?2026h');
          await frame();
          await frame();
          await write('\\x1b[?2026l' + after);
          await frame();
          await frame();
        };
        // The DOM renderer only marks the cursor of a focused terminal
        term.focus();
        await write('AB');
        await frame();
        // A carriage return moves the cursor without changing a row
        await update('\\r');
        const moved = beforeCursor();
        await update('\\x1b[?25l');
        const hidden = beforeCursor() === undefined;
        await write('\\x1b[?25h');
        await frame();
        // A cursor style change doesn't move it
        await update('\\x1b[6 q');
        const style = document.querySelector('.xterm-rows .xterm-cursor')?.className;
        await write('\\x1b[0 q');
        await frame();
        // Asking for the style the cursor already has draws nothing more
        let renders = 0;
        const listener = term.onRender(() => renders++);
        await update('\\x1b[2 q');
        listener.dispose();
        await write('\\x1b[0 q');
        return { moved, hidden, style, renders };
      })()
    `);
    deepStrictEqual(result, { moved: '', hidden: true, style: 'xterm-cursor xterm-cursor-bar', renders: 1 });

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('finishes the write of an update when a render listener throws at its end', async () => {
    await openTerminal(ctx);
    const result: { line: string, written: boolean, errors: number } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        let errors = 0;
        const onError = event => { errors++; event.preventDefault(); };
        window.addEventListener('error', onError);
        let armed = false;
        const listener = term.onRender(() => {
          if (armed) {
            armed = false;
            throw new Error('render listener');
          }
        });
        await write('A');
        await frame();
        await write('\\x1b[?2026hB');
        await frame();
        // The update ends in the middle of this write, where the listener throws
        armed = true;
        const written = await Promise.race([write('\\x1b[?2026lC'), frame().then(frame).then(() => 'timeout')]) !== 'timeout';
        await frame();
        listener.dispose();
        window.removeEventListener('error', onError);
        return { line: term.buffer.active.getLine(0).translateToString(true), written, errors };
      })()
    `);
    deepStrictEqual(result, { line: 'ABC', written: true, errors: 1 });

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('renders and fires render events during back-to-back updates', async () => {
    await openTerminal(ctx);
    const result: { lines: string[], renders: number } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        const rendered = () => Array.from(document.querySelectorAll('.xterm-rows > div'), row => row.textContent.trimEnd())[0];
        let renders = 0;
        const listener = term.onRender(() => renders++);
        await write('\\x1b[?2026h');
        await frame();
        // One update per frame, and every frame lands in an update, as one starts right after the
        // previous one ends
        const lines = [];
        for (const text of ['A', 'AB', 'ABC', 'ABCD']) {
          await write('\\x1b[?2026l\\x1b[?2026h\\r' + text);
          await frame();
          lines.push(rendered());
        }
        await write('\\x1b[?2026l');
        listener.dispose();
        return { lines, renders };
      })()
    `);
    // Every frame shows the update that ended before it: the terminal draws at the screen's rate
    deepStrictEqual(result.lines, ['', 'A', 'AB', 'ABC']);
    ok(result.renders >= 3);

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('fires render events when an update times out', async () => {
    await openTerminal(ctx);
    const result: { line: string, rendersAfterTimeout: number } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        await write('A');
        await frame();
        await write('\\x1b[?2026hB');
        await frame();
        await frame();
        // The program never ends the update, so it times out
        let rendersAfterTimeout = 0;
        const listener = term.onRender(() => rendersAfterTimeout++);
        await new Promise(resolve => setTimeout(resolve, 1500));
        await frame();
        listener.dispose();
        return { line: term.buffer.active.getLine(0).translateToString(true), rendersAfterTimeout };
      })()
    `);
    strictEqual(result.line, 'AB');
    ok(result.rendersAfterTimeout > 0);

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });

  test('scrolls the scrollbar with the drawn frames during back-to-back updates', async () => {
    await openTerminal(ctx);
    const result: { rows: number[] } = await ctx.page.evaluate(`
      (async () => {
        const term = window.term;
        const write = data => new Promise(resolve => term.write(data, resolve));
        const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        const scrollable = term._core._viewport._scrollableElement;
        const cellHeight = term._core._renderService.dimensions.css.cell.height;
        // Fill the screen, so that each update scrolls
        await write('\\r\\n'.repeat(term.rows));
        await frame();
        await frame();
        await write('\\x1b[?2026h');
        await frame();
        const rows = [];
        for (let i = 0; i < 4; i++) {
          // One update per frame, each ending with the next one started
          await write('\\x1b[?2026l\\x1b[?2026h' + 'line\\r\\n'.repeat(5));
          await frame();
          rows.push(Math.round(scrollable.getScrollPosition().scrollTop / cellHeight));
        }
        await write('\\x1b[?2026l');
        return { rows };
      })()
    `);
    // The scrollbar follows each drawn frame, which shows the update that ended before it
    deepStrictEqual(result.rows.slice(1).map((row, i) => row - result.rows[i]), [5, 5, 5]);

    // leave the page in a clean state for any tests that might run after this file
    await openTerminal(ctx);
  });
});
