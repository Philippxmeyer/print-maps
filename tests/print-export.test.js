/* DOM/Mapbox/jsPDF contract tests. Real WebGL/PDF integration: browser.cjs. */
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Scale = require('../js/print-scale.js');
const Tiles = require('../js/print-tiles.js');

function application() {
    const elements = {}, rendered = [], pdfs = [], downloads = [], canvases = [];
    let context, active = 0, maximumActive = 0, failureAt = 0;
    function element(id, value = '') {
        const events = {};
        const el = {id, value, style: {}, checked: false, disabled: false, hidden: false,
            children: [], textContent: '', scrollHeight: 1000,
            classList: {add() {}, remove() {}, toggle() {}},
            setAttribute() {}, addEventListener(name, fn) { events[name] = fn; },
            dispatch(name) { if (events[name]) events[name]({target: el}); },
            appendChild(child) { child.parentNode = el; el.children.push(child); },
            removeChild(child) { el.children.splice(el.children.indexOf(child), 1); child.parentNode = null; }};
        Object.defineProperties(el, {
            clientWidth: {get: () => parseFloat(el.style.width) || 0},
            clientHeight: {get: () => parseFloat(el.style.height) || 0}
        });
        if (id) elements[id] = el;
        return el;
    }
    const ids = [...fs.readFileSync(require.resolve('../index.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map(m => m[1]);
    ids.forEach(id => element(id));
    const defaults = {widthInput: '8', heightInput: '6', dpiInput: '300', sizeMode: 'size',
        paperFormat: 'a4', paperOrientation: 'portrait', sheetColumns: '3', sheetRows: '2', sheetOverlap: '15',
        styleSelect: 'mapbox://styles/mapbox/bright-v9'};
    Object.entries(defaults).forEach(([id, value]) => { elements[id].value = value; });
    const form = elements.config;
    Object.assign(form, elements);
    form.unitOptions = [elements.inUnit, elements.mmUnit];
    form.unitOptions[0].checked = true;
    form.outputOptions = [element('', 'png'), element('', 'pdf')];
    form.outputOptions[0].checked = true;
    form.querySelector = () => elements['config-fields'];
    elements.map.style = {width: '768px', height: '576px'};
    const body = element('');
    const document = {body, documentElement: {clientHeight: 1200}, activeElement: null,
        getElementById: id => elements[id],
        createElement(type) {
            const el = element('');
            if (type !== 'canvas') return el;
            const ctx = {measureText: text => ({width: text.length * 2})};
            for (const name of ['save', 'restore', 'scale', 'translate', 'fillRect', 'strokeRect', 'fillText', 'setLineDash']) ctx[name] = () => {};
            ctx.drawImage = (...args) => { el.drawArgs = args; };
            el.getContext = () => ctx;
            el.toDataURL = () => 'canvas-' + canvases.indexOf(el);
            el.toBlob = callback => callback(context.failBlob ? null : {type: 'image/png'});
            canvases.push(el);
            return el;
        }};
    class Map {
        constructor(options) {
            this.options = options; this.events = {};
            this.container = typeof options.container === 'string' ? elements[options.container] : options.container;
            this.center = Array.isArray(options.center) ? {lng: options.center[0], lat: options.center[1]} : {...options.center};
            this.transform = {zoom: options.zoom, pitch: 0};
            this.touchPitch = {disable() {}};
            this.isRender = !!options.preserveDrawingBuffer;
            if (this.isRender) {
                rendered.push(this);
                if (rendered.length === failureAt) throw new Error('deliberate render failure');
                active++; maximumActive = Math.max(maximumActive, active);
            }
        }
        on(name, fn) { (this.events[name] ||= []).push(fn); }
        once(name, fn) { if (name === 'idle') queueMicrotask(fn); else this.on(name, fn); }
        emit(name) { (this.events[name] || []).forEach(fn => fn({})); }
        getCenter() { return this.center; }
        getZoom() { return this.transform.zoom; }
        getPitch() { return this.transform.pitch; }
        getBearing() { return this.options.bearing || 0; }
        getMinZoom() { return 0; }
        getMaxZoom() { return 22; }
        isZooming() { return false; }
        loaded() { return false; }
        _update() {}
        addControl() {}
        stop() {}
        resize() { this.emit('move'); this.emit('resize'); }
        getContainer() { return this.container; }
        getStyle() { return {name: 'Contract test map'}; }
        getCanvas() {
            return {width: Math.floor(this.container.clientWidth * context.devicePixelRatio),
                height: Math.floor(this.container.clientHeight * context.devicePixelRatio),
                getContext: () => ({MAX_RENDERBUFFER_SIZE: 1, MAX_TEXTURE_SIZE: 2, getParameter: () => 8192})};
        }
        remove() { if (this.isRender) active--; }
    }
    class Pdf {
        constructor(options) {
            this.options = options; this.pages = [{format: options.format, images: [], texts: []}];
            this.internal = {scaleFactor: 72 / 25.4}; pdfs.push(this);
        }
        addPage(format, orientation) { this.pages.push({format, orientation, images: [], texts: []}); }
        addImage(...args) { this.pages.at(-1).images.push(args); }
        text(...args) { this.pages.at(-1).texts.push(args); }
        getStringUnitWidth(text) { return text.length / 2; }
        setProperties(properties) { this.properties = properties; }
        save(name) { downloads.push(name); }
    }
    for (const name of ['line', 'setDrawColor', 'setTextColor', 'setLineWidth', 'setFontSize', 'setFillColor', 'rect']) Pdf.prototype[name] = () => {};
    context = vm.createContext({document, navigator: {}, mapboxgl: {Map, NavigationControl: class {}},
        PrintScale: Scale, PrintTiles: Tiles, jsPDF: Pdf, setTimeout, clearTimeout,
        saveAs: (blob, name) => downloads.push(name), devicePixelRatio: 1});
    context.window = context;
    vm.runInContext(fs.readFileSync(require.resolve('../js/script.js'), 'utf8'), context);
    context.map.center = {lng: 6.95, lat: 50.85};
    context.map.emit('load');
    form.scaleInput.value = '25000';
    context.scaleController.setTarget(25000);
    return {context, elements, rendered, pdfs, downloads, canvases,
        active: () => active, maximumActive: () => maximumActive,
        failAt: n => { failureAt = n; },
        sheets() { form.sizeMode.value = 'sheets'; form.sizeMode.dispatch('change'); }};
}

test('3x2 A4 exports six PDF pages at one world zoom, sequentially, with marks and neighbours', async () => {
    const app = application(), {context: c, elements: e} = app;
    app.sheets();
    assert.equal(e.customWidth.hidden, true);
    assert.equal(e.config.outputOptions[0].disabled, true);
    assert.equal(e.config.outputOptions[1].checked, true);
    assert.match(e['sheet-summary'].textContent, /540 × 539 mm/);
    const target = c.scaleController.target;
    await c.generateMap();
    assert.deepEqual(app.downloads, ['map-3x2-a4.pdf']);
    const pdf = app.pdfs[0];
    assert.equal(pdf.pages.length, 6);
    for (let i = 0; i < 6; i++) {
        assert.deepEqual(Array.from(pdf.pages[i].format), [210, 297]);
        assert.deepEqual(pdf.pages[i].images[0].slice(2, 6), [10, 10, 190, 277]);
        assert.ok(pdf.pages[i].texts.some(t => t[0].includes(`Blatt ${i + 1}/6`)));
        assert.equal(app.rendered[i].options.zoom, Scale.zoomFromScale(50.85, 25000));
    }
    assert.notEqual(app.rendered[0].center.lat, app.rendered[3].center.lat);
    assert.equal(c.scaleController.target, target);
    assert.equal(c.devicePixelRatio, 1);
    assert.equal(c.exporting, false);
    assert.equal(e['config-fields'].disabled, false);
    assert.equal(app.maximumActive(), 1);
    assert.equal(app.active(), 0);
    assert.ok(app.canvases.filter(canvas => canvas.drawArgs).every(canvas => canvas.width === 0));
    assert.match(e['export-status'].textContent, /6 Seiten erstellt/);
});

test('all DIN formats export in both orientations and 1x1 adds no blank PDF page', async () => {
    for (const format of Object.keys(Tiles.FORMATS)) {
        for (const orientation of ['portrait', 'landscape']) {
            const app = application(), {context: c, elements: e} = app;
            app.sheets();
            e.paperFormat.value = format; e.paperOrientation.value = orientation;
            e.sheetColumns.value = e.sheetRows.value = '1'; e.dpiInput.value = '75';
            c.validateDimensions();
            await c.generateMap();
            assert.equal(app.downloads.length, 1, `${format} ${orientation}`);
            assert.equal(app.pdfs[0].pages.length, 1);
            const size = Tiles.FORMATS[format];
            assert.deepEqual(Array.from(app.pdfs[0].options.format), orientation === 'portrait' ? size : [...size].reverse());
        }
    }
});

test('custom overlap updates preview extent, PDF labels and metadata while preserving print scale', async () => {
    for (const [overlap, extent] of [['0', '570 × 554 mm'], ['0.5', '569 × 553.5 mm'], ['30', '510 × 524 mm']]) {
        const app = application(), {context: c, elements: e} = app;
        app.sheets();
        e.sheetOverlap.value = overlap;
        e.sheetOverlap.dispatch('input');
        assert.equal(e['generate-btn'].disabled, false);
        assert.ok(e['sheet-summary'].textContent.includes(extent));
        assert.equal(c.posterLayout.overlap, Number(overlap));
        assert.ok(c.previewGrid.width > 0);
        await c.generateMap();
        const pdf = app.pdfs[0];
        assert.equal(pdf.pages.length, 6);
        assert.ok(pdf.properties.subject.includes(`overlap ${overlap} mm`));
        for (const page of pdf.pages) {
            assert.ok(page.texts.some(t => t[0].includes(`${overlap} mm Ueberlappung`)));
            assert.ok(page.texts.some(t => t[0].includes(overlap === '0' ? 'Kartenkanten buendig' : `${overlap} mm ueberlappen`)));
        }
        assert.equal(c.scaleController.target, 25000);
        const expected = Tiles.pageCenter(Tiles.layout('a4', 'portrait', 3, 2, Number(overlap)),
            c.posterLayout.pages[0], {lng: 6.95, lat: 50.85}, Scale.zoomFromScale(50.85, 25000), 0);
        assert.deepEqual(app.rendered[0].center, expected);
        e.sizeMode.value = 'size'; e.sizeMode.dispatch('change');
        assert.equal(e.sheetOverlap.disabled, true);
        e.sizeMode.value = 'sheets'; e.sizeMode.dispatch('change');
        assert.equal(e.sheetOverlap.value, overlap);
        assert.equal(e.sheetOverlap.disabled, false);
    }
});

test('invalid overlap blocks export and a valid value recovers immediately', () => {
    const app = application(), {context: c, elements: e} = app;
    app.sheets();
    for (const overlap of ['', ' ', '-0.1', '30.1', 'Infinity', 'NaN']) {
        e.sheetOverlap.value = overlap; e.sheetOverlap.dispatch('input');
        assert.equal(e['generate-btn'].disabled, true);
        assert.match(e['error-message'].textContent, /0 bis 30 mm/);
        assert.equal(c.posterLayout, null);
    }
    e.sheetOverlap.value = '0'; e.sheetOverlap.dispatch('input');
    assert.equal(e['generate-btn'].disabled, false);
    assert.equal(app.rendered.length, 0);
});

test('invalid counts and excessive A0 resolution block export; reducing DPI recovers', () => {
    const app = application(), {context: c, elements: e} = app;
    app.sheets();
    for (const value of ['', '0', '-1', '1.5', '11', 'Infinity']) {
        e.sheetColumns.value = value; c.validateDimensions();
        assert.equal(e['generate-btn'].disabled, true, value);
    }
    e.sheetColumns.value = '3'; e.paperFormat.value = 'a0'; c.validateDimensions();
    assert.equal(e['generate-btn'].disabled, true);
    assert.match(e['error-message'].textContent, /DPI/);
    e.dpiInput.value = '75'; c.validateDimensions();
    assert.equal(e['generate-btn'].disabled, false);
    assert.equal(app.rendered.length, 0);
});

test('a later sheet failure saves no partial PDF and restores DPR, controls and canvas state', async () => {
    const app = application(), {context: c, elements: e} = app;
    app.sheets(); app.failAt(2);
    const descriptor = Object.getOwnPropertyDescriptor(c, 'devicePixelRatio');
    await c.generateMap();
    assert.deepEqual(app.downloads, []);
    assert.equal(app.rendered.length, 2);
    assert.equal(app.active(), 0);
    assert.equal(c.exporting, false);
    assert.equal(e['config-fields'].disabled, false);
    assert.equal(e['generate-btn'].disabled, false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(c, 'devicePixelRatio'), descriptor);
    assert.match(e['modal-error-text'].textContent, /deliberate render failure/);
});

test('switching back restores custom size and format; PNG errors also clean up', async () => {
    const app = application(), {context: c, elements: e} = app;
    app.sheets(); e.sizeMode.value = 'size'; e.sizeMode.dispatch('change');
    assert.equal(e.widthInput.value, '8'); assert.equal(e.heightInput.value, '6');
    assert.equal(e.config.outputOptions[0].checked, true);
    assert.equal(c.scaleController.viewportScale, 1);
    await c.generateMap();
    assert.deepEqual(app.downloads, ['map.png']);
    const canvas = app.canvases.find(canvas => canvas.drawArgs);
    assert.equal(canvas.drawArgs.length, 9);
    assert.equal(canvas.width, 0);
    c.failBlob = true;
    await c.generateMap();
    assert.match(e['modal-error-text'].textContent, /PNG konnte nicht erstellt/);
    assert.equal(c.devicePixelRatio, 1); assert.equal(c.exporting, false);
    assert.equal(app.active(), 0);
});

test('PDF constructor failure restores the UI before any sheet is rendered', async () => {
    const app = application(), {context: c, elements: e} = app;
    app.sheets();
    c.jsPDF = class { constructor() { throw new Error('PDF library unavailable'); } };
    await c.generateMap();
    assert.match(e['modal-error-text'].textContent, /PDF library unavailable/);
    assert.equal(e['config-fields'].disabled, false);
    assert.equal(e['generate-btn'].disabled, false);
    assert.equal(c.exporting, false);
    assert.equal(app.rendered.length, 0);
});
