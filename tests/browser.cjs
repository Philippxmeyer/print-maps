/* Optional integration test: installed Playwright + Chromium, no app build step.
 * Start python3 -m http.server 8000, then node tests/browser.cjs.
 * PRINT_MAPS_TEST_ASSETS can hold the unchanged CDN files for offline testing.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const output = process.env.PRINT_MAPS_TEST_OUTPUT || '/tmp/print-maps-browser';
fs.mkdirSync(output, {recursive: true});
const style = {
    version: 8, name: 'Local WebGL test map', sources: {
        land: {type: 'geojson', data: {type: 'Feature', properties: {}, geometry: {
            type: 'Polygon', coordinates: [[[6, 50], [8, 50], [8, 52], [6, 52], [6, 50]]]
        }}}
    }, layers: [
        {id: 'background', type: 'background', paint: {'background-color': '#85b9cd'}},
        {id: 'land', type: 'fill', source: 'land', paint: {
            'fill-color': ['step', ['zoom'], '#b5d49e', 14, '#d49e9e']}}
    ]
};
const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a / b - 1) < e, `${a} != ${b}`);
(async () => {
    const browser = await chromium.launch({executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
        headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    try {
        const context = await browser.newContext({viewport: {width: 1500, height: 1200}, hasTouch: true});
        const errors = [];
        const page = await context.newPage();
        await page.addInitScript(() => {
            // Deterministic geolocation response, delivered after choosing scale.
            navigator.geolocation.getCurrentPosition = success => { window.testLocate = success; };
        });
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://tiles.stadiamaps.com/**', route => route.fulfill({json: style}));
        await page.route('https://api.mapbox.com/**', route => route.fulfill({json: style}));
        await page.route('https://events.mapbox.com/**', route => route.fulfill({status: 204}));
        const assets = process.env.PRINT_MAPS_TEST_ASSETS;
        if (assets) {
            await page.route('https://api.tiles.mapbox.com/**', route => route.fulfill({
                path: path.join(assets, route.request().url().endsWith('.css') ? 'mapbox-gl.css' : 'mapbox-gl.js')
            }));
            await page.route('https://cdn.jsdelivr.net/**', route => {
                const url = route.request().url();
                if (url.includes('canvas-toblob')) return route.fulfill({body: '/* Native Chromium toBlob. */', contentType: 'application/javascript'});
                return route.fulfill({path: path.join(assets, url.includes('jspdf') ? 'jspdf.min.js' : 'FileSaver.min.js'),
                    contentType: 'application/javascript'});
            });
        }
        await page.goto(process.env.PRINT_MAPS_TEST_URL || 'http://127.0.0.1:8000');
        await page.waitForFunction(() => window.scaleController && scaleController.target !== null);
        assert.equal(await page.locator('#zoomInput').getAttribute('readonly'), '');
        await page.evaluate(() => {
            form.scaleInput.value = '25000';
            form.scaleInput.dispatchEvent(new Event('input'));
            form.scaleInput.dispatchEvent(new Event('change'));
            map.jumpTo({center: [6.95, 50.85]});
        });
        near(await page.evaluate(() => map.getZoom()), 12.867, 0.0001);
        assert.equal(await page.evaluate(() => scaleController.target), 25000);
        await page.evaluate(() => testLocate({coords: {latitude: 48.137, longitude: 11.576}}));
        near(await page.evaluate(() => map.getCenter().lat), 48.137);
        assert.equal(await page.evaluate(() => scaleController.target), 25000);
        await page.locator('#latInput').fill('50.85');
        await page.locator('#latInput').dispatchEvent('change');
        await page.locator('#latInput').blur();
        near(await page.evaluate(() => map.getCenter().lat), 50.85);
        assert.equal(await page.evaluate(() => scaleController.target), 25000);
        for (const lat of [60, 40, 50.85]) {
            await page.evaluate(lat => map.jumpTo({center: [6.95, lat], zoom: 5, pitch: 35}), lat);
            near(await page.evaluate(() => PrintScale.scaleFromZoom(map.getCenter().lat, map.getZoom())), 25000);
            assert.equal(await page.evaluate(() => map.getPitch()), 0);
        }
        const canvas = page.locator('#map .mapboxgl-canvas');
        await canvas.scrollIntoViewIfNeeded();
        let box = await canvas.boundingBox();
        async function drag() {
            const before = await page.evaluate(() => ({lat: map.getCenter().lat, target: scaleController.target}));
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 100, {steps: 12});
            await page.mouse.up();
            await page.waitForFunction(() => !map.isMoving());
            const after = await page.evaluate(() => ({lat: map.getCenter().lat,
                actual: PrintScale.scaleFromZoom(map.getCenter().lat, map.getZoom()), target: scaleController.target}));
            assert.notEqual(after.lat, before.lat, 'drag actually moved the camera');
            near(after.target, before.target);
            near(after.actual, before.target);
        }
        await drag();
        const beforeButton = await page.evaluate(() => scaleController.target);
        await page.locator('.mapboxgl-ctrl-zoom-in').click();
        await page.waitForTimeout(400);
        await page.waitForFunction(() => !map.isMoving());
        assert.ok(await page.evaluate(() => scaleController.target) < beforeButton);
        await drag();
        await canvas.scrollIntoViewIfNeeded();
        box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -250);
        await page.waitForTimeout(800);
        await page.waitForFunction(() => !map.isMoving());
        assert.notEqual(await page.evaluate(() => scaleController.target), 25000);
        await drag();
        // Native multi-touch input exercises real Mapbox pinch+pan handlers.
        const session = await context.newCDPSession(page);
        const x = box.x + 300, y = box.y + 200;
        const touch = (id, px, py) => ({id, x: px, y: py});
        const oldTarget = await page.evaluate(() => scaleController.target);
        await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [touch(1, x, y), touch(2, x + 100, y)]});
        for (let n = 1; n <= 8; n++) {
            await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [
                touch(1, x - 4 * n, y + 3 * n), touch(2, x + 100 + 7 * n, y + 3 * n)]});
            await page.waitForTimeout(20);
        }
        await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await page.waitForFunction(() => !map.isMoving());
        assert.notEqual(await page.evaluate(() => scaleController.target), oldTarget);
        assert.equal(await page.evaluate(() => map.getPitch()), 0);
        await drag();
        // Programmatic animation with a zoom must not replace the target.
        const target = await page.evaluate(() => scaleController.target);
        await page.evaluate(() => map.flyTo({center: [7, 51], zoom: 9, duration: 120}));
        await page.waitForFunction(() => !map.isMoving());
        near(await page.evaluate(() => scaleController.target), target);
        near(await page.evaluate(() => PrintScale.scaleFromZoom(map.getCenter().lat, map.getZoom())), target);
        // A scale input must update zoom-dependent style properties and tiles,
        // even though the correction itself emits no synthetic camera events.
        await page.selectOption('#scalePreset', '10000');
        await page.waitForFunction(() => map.loaded());
        const styleImage = await canvas.screenshot();
        const stylePixel = await page.evaluate(async data => {
            const image = new Image(); image.src = 'data:image/png;base64,' + data;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            return Array.from(ctx.getImageData(image.width / 2, image.height / 2, 1, 1).data);
        }, styleImage.toString('base64'));
        assert.ok(stylePixel[0] > stylePixel[1], `zoom-dependent style updated: ${stylePixel}`);
        console.log('PASS: real WebGL camera, geolocation callback, coordinates, drag, zoom button, wheel, combined pinch/pan, programmatic flight, pitch lock, zoom-dependent styling');

        await page.evaluate(() => {
            form.mmUnit.click();
            form.widthInput.value = '297';
            form.heightInput.value = '210';
            form.dpiInput.value = '150';
            form.scalePreset.value = '25000';
            form.scalePreset.dispatchEvent(new Event('change'));
            validateDimensions();
            form.scaleBarInput.click();
        });
        assert.equal(await page.evaluate(() => scaleController.target), 25000);
        await page.screenshot({path: path.join(output, 'preview.png'), fullPage: true});
        async function exportFile(format, dpi, bar, name) {
            await page.evaluate(({format, dpi, bar}) => {
                form.outputOptions[0].checked = format === 'png';
                form.outputOptions[1].checked = format === 'pdf';
                form.dpiInput.value = dpi;
                form.scaleBarInput.checked = bar;
                validateDimensions();
                drawPreviewBar();
            }, {format, dpi, bar});
            const promise = page.waitForEvent('download');
            await page.locator('#generate-btn').click();
            const download = await promise;
            await download.saveAs(path.join(output, name));
            await page.waitForFunction(() => !exporting);
            assert.equal(await page.locator('.hidden-map').count(), 0);
            assert.equal(await page.evaluate(() => window.devicePixelRatio), 1);
            assert.equal(await page.locator('#generate-btn').isDisabled(), false);
            near(await page.evaluate(() => scaleController.target), 25000);
        }
        await exportFile('png', 150, true, 'a4-150-bar.png');
        await exportFile('png', 300, true, 'a4-300-bar.png');
        await exportFile('png', 150, false, 'a4-150-plain.png');
        await exportFile('pdf', 150, true, 'a4-bar.pdf');
        await exportFile('pdf', 150, false, 'a4-plain.pdf');
        for (const [name, dpi, bar] of [['a4-150-bar.png', 150, true], ['a4-300-bar.png', 300, true], ['a4-150-plain.png', 150, false]]) {
            const bytes = fs.readFileSync(path.join(output, name));
            assert.equal(bytes.readUInt32BE(16), Math.round(297 / 25.4 * dpi));
            assert.equal(bytes.readUInt32BE(20), Math.round(210 / 25.4 * dpi));
            const color = await page.evaluate(async ({data, dpi}) => {
                const image = new Image();
                image.src = 'data:image/png;base64,' + data;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width; canvas.height = image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0);
                return Array.from(ctx.getImageData(Math.round(6 / 25.4 * dpi), Math.round(12 / 25.4 * dpi), 1, 1).data);
            }, {data: bytes.toString('base64'), dpi});
            assert.equal(color.slice(0, 3).every(c => c < 30), bar, `${name}: physical bar location ${color}`);
        }
        for (const file of ['a4-bar.pdf', 'a4-plain.pdf']) {
            const bytes = fs.readFileSync(path.join(output, file));
            assert.ok(bytes.subarray(0, 8).toString().startsWith('%PDF-'));
            assert.ok(bytes.length > 10000);
        }
        console.log('PASS: A4 PNG 150/300 DPI dimensions and physical bar pixels, PNG/PDF with/without bar, export cleanup');

        // Very small paper and invalid input / unreachable scales.
        await page.evaluate(() => {
            form.widthInput.value = '10'; form.heightInput.value = '8';
            form.scaleBarInput.checked = true; validateDimensions(); drawPreviewBar();
        });
        await page.screenshot({path: path.join(output, 'small-preview.png'), fullPage: true});
        await exportFile('png', 150, true, 'small.png');
        await page.locator('#scaleInput').fill('-1');
        await page.locator('#scaleInput').dispatchEvent('change');
        assert.equal(await page.locator('#generate-btn').isDisabled(), true);
        await page.locator('#scaleInput').fill('1e20');
        await page.locator('#scaleInput').dispatchEvent('change');
        assert.equal(await page.locator('#generate-btn').isDisabled(), true);
        assert.ok((await page.locator('#scale-status').textContent()).includes('Tatsächlicher'));
        await page.locator('#scaleInput').fill('25000');
        await page.locator('#scaleInput').dispatchEvent('change');
        assert.equal(await page.locator('#generate-btn').isDisabled(), false);
        await page.locator('#dpiInput').fill('Infinity');
        await page.locator('#dpiInput').dispatchEvent('change');
        assert.equal(await page.locator('#generate-btn').isDisabled(), true);
        await page.locator('#dpiInput').fill('150');
        await page.locator('#dpiInput').dispatchEvent('change');
        // Constructor failure: exact DPR descriptor and all UI state restored.
        assert.equal(await page.evaluate(async () => {
            const original = mapboxgl.Map;
            const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
            mapboxgl.Map = function() { throw new Error('deliberate constructor failure'); };
            try { await generateMap(); } finally { mapboxgl.Map = original; }
            return descriptor.get === Object.getOwnPropertyDescriptor(window, 'devicePixelRatio').get &&
                !exporting && !document.querySelector('.hidden-map') && !form.querySelector('fieldset').disabled;
        }), true);
        assert.ok((await page.locator('#modal-error-text').textContent()).includes('deliberate constructor failure'));
        await page.evaluate(() => closeErrorModal());
        assert.equal(await page.evaluate(async () => {
            const original = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function(callback) { callback(null); };
            try { await generateMap(); } finally { HTMLCanvasElement.prototype.toBlob = original; }
            return !exporting && !document.querySelector('.hidden-map') && window.devicePixelRatio === 1;
        }), true);
        assert.ok((await page.locator('#modal-error-text').textContent()).includes('PNG konnte nicht erstellt'));
        assert.deepEqual(errors, []);
        console.log('PASS: small paper, invalid scale/DPI, zoom limits, constructor/PNG failure cleanup; no browser exceptions');
        console.log('Artifacts:', output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
