'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Scale = require('../js/print-scale.js');
function near(actual, expected, tolerance = 1e-9) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
class Camera {
    constructor() {
        this.lat = 50.85;
        this.transform = {zoom: Scale.zoomFromScale(this.lat, 25000), pitch: 0};
        this.listeners = {};
        this.userZoom = false;
        this.repaintCount = 0;
    }
    on(name, fn) { (this.listeners[name] ||= []).push(fn); return this; }
    fire(name, data) { (this.listeners[name] || []).forEach(fn => fn(data)); }
    getCenter() { return {lat: this.lat, lng: 0}; }
    getZoom() { return this.transform.zoom; }
    getPitch() { return this.transform.pitch; }
    getMinZoom() { return 0; }
    getMaxZoom() { return 22; }
    isZooming() { return this.userZoom; }
    _update() { this.repaintCount++; }
}
function ready() {
    const map = new Camera();
    const states = [];
    const controller = new Scale.Controller(map, state => states.push(state));
    map.fire('load');
    return {map, controller, states};
}

test('Mercator conversion uses 512px tiles, local latitude and 96 CSS DPI', () => {
    near(Scale.zoomFromScale(50.85, 25000), 12.867, 0.001);
    for (const latitude of [-85.051129, -85, -50.85, 0, 50.85, 85, 85.051129]) {
        for (const scale of [5000, 10000, 25000, 100000, 25432.123456789]) {
            near(Scale.scaleFromZoom(latitude, Scale.zoomFromScale(latitude, scale)), scale, 1e-8);
        }
    }
    for (const bad of [0, -1, NaN, Infinity]) assert.ok(Number.isNaN(Scale.zoomFromScale(0, bad)));
    assert.ok(Number.isNaN(Scale.zoomFromScale(90, 25000)));
});

test('A4 landscape ground extent and physical scale bar size', () => {
    near(297 / 1000 * 25000, 7425);
    near(210 / 1000 * 25000, 5250);
    for (const dpi of [96, 150, 300]) {
        const pixels = Scale.distancePixels(500, 25000, dpi);
        near(pixels / dpi * 25.4, 20);
    }
    const a = Scale.barLayout(297, 210, 25000);
    for (const dpi of [150, 300]) {
        const b = Scale.barLayout(297, 210, 25000);
        near(Scale.distancePixels(b.distance, 25000, dpi) / dpi * 25.4, a.length);
    }
});

test('panning and programmatic zoom/center changes retain the full target', () => {
    const {map, controller} = ready();
    const target = 25432.123456789;
    controller.setTarget(target);
    for (const lat of [60, 40, -70, 0, 50.85]) {
        map.lat = lat;
        map.fire('move', {originalEvent: {type: 'pan'}});
        near(controller.target, target, 0);
        near(Scale.scaleFromZoom(lat, map.getZoom()), target, 1e-8);
        map.transform.zoom = 5; // arbitrary application flyTo or jumpTo
        map.fire('move', {});
        near(controller.target, target, 0);
        near(Scale.scaleFromZoom(lat, map.getZoom()), target, 1e-8);
    }
    assert.ok(map.repaintCount < 20, 'corrections must not create an event loop');
});

test('combined user pan+zoom adopts a new target; following pan preserves it', () => {
    const {map, controller} = ready();
    map.lat = 60;
    map.transform.zoom = 14.123456789;
    map.userZoom = true;
    map.fire('move', {originalEvent: {type: 'touchmove'}});
    const target = Scale.scaleFromZoom(60, 14.123456789);
    near(controller.target, target, 0);
    map.userZoom = false;
    map.lat = 45;
    map.fire('moveend', {originalEvent: {type: 'touchend'}});
    near(controller.target, target, 0);
    near(Scale.scaleFromZoom(45, map.getZoom()), target, 1e-8);
});

test('isolated Mapbox wheel zoom without originalEvent is still a user zoom', () => {
    const {map, controller} = ready();
    map.scrollZoom = {isZooming: () => true};
    map.userZoom = true;
    map.transform.zoom += 0.75;
    const scale = Scale.scaleFromZoom(map.lat, map.getZoom());
    map.fire('move', {});
    near(controller.target, scale, 0);
    map.scrollZoom.isZooming = () => false;
    map.transform.zoom += 1; // programmatic zoom, not a wheel gesture
    map.fire('move', {});
    near(controller.target, scale, 0);
    near(Scale.scaleFromZoom(map.lat, map.getZoom()), scale);
});

test('zoom limits keep the requested target but flag the actual scale; recovery works', () => {
    const {map, controller} = ready();
    assert.equal(controller.setTarget(1e20), false);
    assert.equal(controller.target, 1e20);
    near(map.getZoom(), 0);
    assert.ok(controller.actual < controller.target);
    assert.equal(controller.setTarget(25000), true);
    assert.equal(controller.setTarget(NaN), false);
    assert.equal(controller.target, 25000);
    map.transform.pitch = 40;
    map.fire('move', {});
    assert.equal(map.getPitch(), 0);
});

test('paper resizing never changes scale; initialize is idempotent', () => {
    const {map, controller} = ready();
    const target = controller.target;
    for (let i = 0; i < 10; i++) map.fire('move', {}); // Mapbox resize emits move
    map.transform.zoom = 4;
    controller.initialize();
    near(controller.target, target, 0);
});

test('bar lengths use 1/2/5 steps and fit even very small paper', () => {
    for (const [width, height] of [[297, 210], [65, 40], [20, 10], [5, 5], [0.3, 0.3]]) {
        for (const scale of [5000, 25000, 1e9]) {
            const b = Scale.barLayout(width, height, scale);
            assert.ok(b.x + b.width <= width && b.y + b.height <= height);
            assert.ok(b.length + b.padding * 2 <= width - b.x * 2);
            near(b.length, b.distance / scale * 1000);
            const mantissa = b.distance / 10 ** Math.floor(Math.log10(b.distance));
            assert.ok([1, 2, 5].some(n => Math.abs(n - mantissa) < 1e-9));
        }
    }
});
