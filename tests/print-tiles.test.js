'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Tiles = require('../js/print-tiles.js');
const Scale = require('../js/print-scale.js');
function near(actual, expected, tolerance = 1e-8) {
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}
function world(center, zoom) {
    const size = 512 * 2 ** zoom;
    return [(center.lng + 180) / 360 * size,
        (1 - Math.log(Math.tan(Math.PI / 4 + center.lat * Math.PI / 360)) / Math.PI) / 2 * size];
}

test('3 x 2 A4 portrait has six ordered sheets, 10 mm margins and 15 mm repeated map', () => {
    const p = Tiles.layout('a4', 'portrait', 3, 2);
    assert.deepEqual([p.pageWidth, p.pageHeight, p.imageWidth, p.imageHeight], [210, 297, 190, 277]);
    assert.deepEqual([p.width, p.height, p.overlap, p.margin], [540, 539, 15, 10]);
    assert.deepEqual(p.pages.map(page => page.label), ['Z1-S1', 'Z1-S2', 'Z1-S3', 'Z2-S1', 'Z2-S2', 'Z2-S3']);
    for (const page of p.pages) {
        near(page.x + p.imageWidth - (page.column + 1) * (p.imageWidth - p.overlap), 15);
        near(page.y + p.imageHeight - (page.row + 1) * (p.imageHeight - p.overlap), 15);
    }
});

test('all five DIN sizes support both orientations, including a single sheet', () => {
    const sizes = {a0: [841, 1189], a1: [594, 841], a2: [420, 594], a3: [297, 420], a4: [210, 297]};
    for (const [format, dimensions] of Object.entries(sizes)) {
        for (const orientation of ['portrait', 'landscape']) {
            const p = Tiles.layout(format, orientation, 1, 1);
            assert.deepEqual([p.pageWidth, p.pageHeight], orientation === 'portrait' ? dimensions : [...dimensions].reverse());
            assert.equal(p.width, p.pageWidth - 20);
            assert.equal(p.height, p.pageHeight - 20);
            assert.equal(p.pages.length, 1);
            const center = Tiles.pageCenter(p, p.pages[0], {lng: 6.95, lat: 50.85}, 12, 33);
            near(center.lng, 6.95); near(center.lat, 50.85);
        }
    }
});

test('0 to 30 mm overlap changes poster extent and keeps neighbouring map coordinates aligned', () => {
    const center = {lng: 6.95, lat: 50.85};
    const zoom = Scale.zoomFromScale(center.lat, 25000);
    for (const [overlap, width, height] of [[0, 570, 554], [0.5, 569, 553.5], [15, 540, 539], [30, 510, 524]]) {
        const p = Tiles.layout('a4', 'portrait', 3, 2, overlap);
        assert.deepEqual([p.width, p.height, p.overlap], [width, height, overlap]);
        for (const bearing of [0, 90, -37]) {
            const a = Tiles.pageCenter(p, p.pages[0], center, zoom, bearing);
            const b = Tiles.pageCenter(p, p.pages[1], center, zoom, bearing);
            const c = Tiles.pageCenter(p, p.pages[3], center, zoom, bearing);
            const left = Tiles.offsetCenter(a, zoom, bearing, (190 - overlap) / 2, 0);
            const right = Tiles.offsetCenter(b, zoom, bearing, -(190 - overlap) / 2, 0);
            const top = Tiles.offsetCenter(a, zoom, bearing, 0, (277 - overlap) / 2);
            const bottom = Tiles.offsetCenter(c, zoom, bearing, 0, -(277 - overlap) / 2);
            near(left.lng, right.lng); near(left.lat, right.lat);
            near(top.lng, bottom.lng); near(top.lat, bottom.lat);
        }
    }
    for (const overlap of [-0.1, 30.1, NaN, Infinity, -Infinity, null, '', '15']) {
        assert.throws(() => Tiles.layout('a4', 'portrait', 3, 2, overlap), /0 bis 30 mm/);
    }
});

test('invalid sizes, orientations and fractional, empty or unbounded counts are rejected', () => {
    for (const value of [0, -1, 1.5, NaN, Infinity, 11, '3']) {
        assert.throws(() => Tiles.layout('a4', 'portrait', value, 2));
        assert.throws(() => Tiles.layout('a4', 'portrait', 3, value));
    }
    assert.throws(() => Tiles.layout('a5', 'portrait', 3, 2));
    assert.throws(() => Tiles.layout('__proto__', 'portrait', 3, 2));
    assert.throws(() => Tiles.layout('a4', 'diagonal', 3, 2));
});

test('overlapping world coordinates match at any bearing and across the date line', () => {
    const p = Tiles.layout('a4', 'portrait', 3, 2);
    for (const center of [{lng: 6.95, lat: 50.85}, {lng: 179.999, lat: -60}]) {
        const zoom = Scale.zoomFromScale(center.lat, 25000);
        const origin = world(center, zoom);
        for (const bearing of [0, 90, -37, 180]) {
            const angle = bearing * Math.PI / 180;
            for (const page of p.pages) {
                const actual = world(Tiles.pageCenter(p, page, center, zoom, bearing), zoom);
                const dx = (page.x + p.imageWidth / 2 - p.width / 2) * 96 / 25.4;
                const dy = (page.y + p.imageHeight / 2 - p.height / 2) * 96 / 25.4;
                near(actual[0] - origin[0], Math.cos(angle) * dx - Math.sin(angle) * dy);
                near(actual[1] - origin[1], Math.sin(angle) * dx + Math.cos(angle) * dy);
            }
            // Midpoint of the common vertical strip, expressed in either sheet.
            const left = p.pages[0], right = p.pages[1];
            const a = Tiles.offsetCenter(Tiles.pageCenter(p, left, center, zoom, bearing), zoom, bearing,
                p.imageWidth / 2 - p.overlap / 2, 0);
            const b = Tiles.offsetCenter(Tiles.pageCenter(p, right, center, zoom, bearing), zoom, bearing,
                -p.imageWidth / 2 + p.overlap / 2, 0);
            near(a.lng, b.lng); near(a.lat, b.lat);
            // Likewise the common horizontal strip.
            const below = p.pages[p.columns];
            const c = Tiles.offsetCenter(Tiles.pageCenter(p, left, center, zoom, bearing), zoom, bearing,
                0, p.imageHeight / 2 - p.overlap / 2);
            const d = Tiles.offsetCenter(Tiles.pageCenter(p, below, center, zoom, bearing), zoom, bearing,
                0, -p.imageHeight / 2 + p.overlap / 2);
            near(c.lng, d.lng); near(c.lat, d.lat);
        }
    }
    assert.throws(() => Tiles.offsetCenter({lng: 0, lat: 85}, 1, 0, 0, -1000), /Mercator/);
});

test('pass marks align within the shared strips and stay in removable margins', () => {
    const p = Tiles.layout('a4', 'portrait', 3, 2);
    function marks(page) {
        const lines = [], texts = [];
        const pdf = {internal: {scaleFactor: 72 / 25.4}, getStringUnitWidth: () => 30};
        for (const name of ['setDrawColor', 'setTextColor', 'setLineWidth', 'setFontSize', 'setFillColor', 'rect']) pdf[name] = () => {};
        pdf.line = (...args) => lines.push(args);
        pdf.text = (...args) => texts.push(args);
        Tiles.drawMarks(pdf, p, page, '(c) OpenStreetMap');
        for (const [x1, y1, x2, y2] of lines) {
            assert.ok(Math.min(x1, x2, y1, y2) >= 5);
            assert.ok(x1 < 10 || x1 > 200 || y1 < 10 || y1 > 287);
            assert.ok(x2 < 10 || x2 > 200 || y2 < 10 || y2 > 287);
        }
        return {lines, texts};
    }
    const left = marks(p.pages[0]), right = marks(p.pages[1]);
    assert.ok(left.lines.some(line => line[0] === 191 && line[1] === 7));
    assert.ok(right.lines.some(line => line[0] === 16 && line[1] === 7));
    near(191 - 16, p.imageWidth - 15);
    assert.ok(left.texts.some(text => text[0].includes('Blatt 1/6')));
    assert.ok(right.texts.some(text => text[0].includes('links: Z1-S1')));
});
