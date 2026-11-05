/*
 * Print Maps - High-resolution maps in the browser, for printing
 * Copyright (c) 2015-2020 Matthew Petroff
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
 
mapboxgl.accessToken = 'pk.eyJ1IjoicGhpbGlwcHhtZXllciIsImEiOiJjbXczNjN0dDEwNjZqMzBzY21mOGJtYnViIn0.Wljtk31uTsLsSjhXWlBYzQ';

var form = document.getElementById('config');
var map, scaleController, previewBar, previewGrid;
var exporting = false;
var scaleInputDirty = false;
var posterLayout = null;
var savedOutputFormat = 'png';
var maxSize = 4096;
var errors = {
    width: {state: false, grp: 'widthGroup'},
    height: {state: false, grp: 'heightGroup'},
    dpi: {state: false, grp: 'dpiGroup'},
    scale: {state: false, grp: 'scaleGroup'},
    latitude: {state: false, grp: 'latGroup'},
    longitude: {state: false, grp: 'lonGroup'},
    sheets: {state: false, grp: 'sheetSettings'}
};

if (!mapboxgl.accessToken || mapboxgl.accessToken.length < 10) {
    for (var i = form.styleSelect.length - 1; i >= 0; i--) {
        if (form.styleSelect[i].value.indexOf('mapbox') >= 0) form.styleSelect.remove(i);
    }
}

function updateAttribution() {
    var isMapbox = form.styleSelect.value.indexOf('mapbox') >= 0;
    document.getElementById('mapbox-attribution').style.display = isMapbox ? 'block' : 'none';
    document.getElementById('stadiamaps-attribution').style.display = isMapbox ? 'none' : 'block';
}
updateAttribution();

function updateLocationInputs() {
    var center = map.getCenter();
    form.zoomInput.value = map.getZoom().toFixed(3);
    // Rounded display values never feed back into the camera or scale maths.
    if (document.activeElement !== form.latInput) form.latInput.value = center.lat.toFixed(4);
    if (document.activeElement !== form.lonInput) form.lonInput.value = center.lng.toFixed(4);
}

function scaleChanged(state) {
    updateLocationInputs();
    if (state.reason === 'initialize' || state.reason === 'userZoom') {
        form.scaleInput.value = Number(state.target.toFixed(state.target < 10 ? 2 : 0));
        scaleInputDirty = false;
    }
    form.scalePreset.value = ['5000', '10000', '25000', '50000', '100000'].filter(function(n) {
        return Math.abs(Number(n) / state.target - 1) < 1e-10;
    })[0] || '';
    errors.scale.state = !state.valid || !PrintScale.positive(Number(form.scaleInput.value));
    errors.scale.msg = 'Dieser Maßstab liegt am Kartenmittelpunkt außerhalb der Zoomgrenzen (' +
        map.getMinZoom() + ' bis ' + map.getMaxZoom() + '). Bitte Maßstab oder Ort ändern.';
    document.getElementById('scale-status').textContent = state.valid ? '' :
        'Angeforderter Maßstab nicht erreichbar. Tatsächlicher Maßstab: 1 : ' +
        PrintScale.formatScale(state.actual) + '. Leiste und Export sind deaktiviert.';
    handleErrors();
    drawPreviewBar();
}

try {
    map = new mapboxgl.Map({
        container: 'map', center: [0, 0], zoom: 0.5, pitch: 0,
        pitchWithRotate: false, touchPitch: false, style: form.styleSelect.value
    });
    if (map.touchPitch) map.touchPitch.disable();
    map.addControl(new mapboxgl.NavigationControl());
    scaleController = new PrintScale.Controller(map, scaleChanged);
    previewBar = document.createElement('canvas');
    previewBar.className = 'print-scale-overlay';
    previewBar.setAttribute('aria-hidden', 'true');
    map.getContainer().appendChild(previewBar);
    previewGrid = document.createElement('canvas');
    previewGrid.className = 'print-grid-overlay';
    previewGrid.setAttribute('aria-hidden', 'true');
    map.getContainer().appendChild(previewGrid);
    var gl = map.getCanvas().getContext('webgl') || map.getCanvas().getContext('experimental-webgl');
    maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
    map.on('resize', drawPreviewBar);
    map.on('resize', drawPreviewGrid);
    if (map.loaded()) scaleController.initialize();
} catch (e) {
    document.getElementById('config-fields').disabled = true;
    document.getElementById('generate-btn').disabled = true;
    openErrorModal('This site requires WebGL: ' + e.message);
}

if (map && 'geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(function(position) {
        function locate() {
            // An immediate center-only move retains the chosen print scale.
            map.jumpTo({center: [position.coords.longitude, position.coords.latitude], pitch: 0});
        }
        if (scaleController.target !== null) locate();
        else map.once('load', locate);
    }, function() { /* Permission is optional; retain the current view. */ });
}

function handleErrors() {
    var messages = [];
    Object.keys(errors).forEach(function(key) {
        var error = errors[key];
        document.getElementById(error.grp).classList.toggle('has-error', error.state);
        if (error.state) messages.push(error.msg);
    });
    var element = document.getElementById('error-message');
    element.textContent = messages.join(' ');
    element.style.display = messages.length ? 'block' : 'none';
    document.getElementById('generate-btn').disabled = exporting || messages.length > 0 ||
        !scaleController || scaleController.target === null;
}
function isError() {
    return Object.keys(errors).some(function(key) { return errors[key].state; });
}
function unit() { return form.unitOptions[0].checked ? 'in' : 'mm'; }
function inches(value) { return unit() === 'mm' ? value / 25.4 : value; }
function toPixels(length) { return inches(length) * PrintScale.CSS_DPI + 'px'; }
function sheetMode() { return form.sizeMode.value === 'sheets'; }

function updateSizeMode() {
    var tiled = sheetMode();
    document.getElementById('sheetSettings').hidden = !tiled;
    ['unitSettings', 'customWidth', 'customHeight'].forEach(function(id) {
        document.getElementById(id).hidden = tiled;
    });
    form.widthInput.disabled = tiled;
    form.heightInput.disabled = tiled;
    form.unitOptions[0].disabled = tiled;
    form.unitOptions[1].disabled = tiled;
    ['paperFormat', 'paperOrientation', 'sheetColumns', 'sheetRows'].forEach(function(id) {
        form[id].disabled = !tiled;
    });
    if (tiled) {
        savedOutputFormat = form.outputOptions[0].checked ? 'png' : 'pdf';
        form.outputOptions[1].checked = true;
    } else {
        form.outputOptions[0].checked = savedOutputFormat === 'png';
        form.outputOptions[1].checked = savedOutputFormat === 'pdf';
    }
    form.outputOptions[0].disabled = tiled;
    form.outputOptions[1].disabled = tiled;
    document.getElementById('generate-btn').textContent = tiled ? 'Mehrseitiges PDF erstellen' : 'Generate Map';
    validateDimensions();
}
form.sizeMode.addEventListener('change', updateSizeMode);
['paperFormat', 'paperOrientation', 'sheetColumns', 'sheetRows'].forEach(function(id) {
    form[id].addEventListener('change', validateDimensions);
    form[id].addEventListener('input', validateDimensions);
});

function validateDimensions() {
    var dpi = Number(form.dpiInput.value);
    errors.dpi.state = !PrintScale.positive(dpi);
    errors.dpi.msg = 'DPI must be a finite positive number!';
    errors.sheets.state = false;
    if (sheetMode()) {
        validateSheets(dpi);
        handleErrors();
        drawPreviewBar();
        drawPreviewGrid();
        return;
    }
    posterLayout = null;
    if (scaleController) scaleController.viewportScale = 1;
    ['width', 'height'].forEach(function(name) {
        var value = inches(Number(form[name + 'Input'].value));
        var cssPixels = value * PrintScale.CSS_DPI;
        var pixels = value * dpi;
        var error = errors[name];
        error.state = !PrintScale.positive(value) || cssPixels < 1 || !Number.isFinite(pixels) ||
            pixels < 1 || Math.ceil(cssPixels) * dpi / PrintScale.CSS_DPI > maxSize ||
            cssPixels * window.devicePixelRatio > maxSize;
        error.msg = name + ': Bitte ein positives Papiermaß mit mindestens einem Vorschau-/Exportpixel ' +
            'und höchstens ' + maxSize + ' Pixeln pro Seite wählen.';
        if (!error.state && map) map.getContainer().style[name] = cssPixels + 'px';
    });
    // Avoid a predictable allocation failure, particularly on small devices.
    if (!errors.width.state && !errors.height.state &&
            inches(Number(form.widthInput.value)) * inches(Number(form.heightInput.value)) * dpi * dpi > 64000000) {
        errors.dpi.state = true;
        errors.dpi.msg = 'Export zu groß (maximal 64 Megapixel). Bitte DPI oder Papiermaß verringern.';
    }
    if (map && !errors.width.state && !errors.height.state) map.resize();
    handleErrors();
    drawPreviewBar();
    drawPreviewGrid();
}

function validateSheets(dpi) {
    errors.width.state = errors.height.state = false;
    posterLayout = null;
    try {
        posterLayout = PrintTiles.layout(form.paperFormat.value, form.paperOrientation.value,
            Number(form.sheetColumns.value), Number(form.sheetRows.value));
    } catch (error) {
        errors.sheets.state = true;
        errors.sheets.msg = error.message;
        document.getElementById('sheet-summary').textContent = '';
        return;
    }
    var p = posterLayout;
    document.getElementById('sheet-summary').textContent = p.columns + ' × ' + p.rows +
        ' = ' + p.pages.length + ' PDF-Seiten, DIN ' + p.format.toUpperCase() + ' ' +
        (p.orientation === 'portrait' ? 'Hochformat' : 'Querformat') +
        '. Kartenfläche nach dem Zusammenkleben: ' + p.width + ' × ' + p.height + ' mm (ohne Außenrand).';
    // Limit the raster of a single sheet, rather than the entire poster. Allow
    // for rounding the render viewport up to whole CSS pixels for exact cropping.
    var cssWidth = p.imageWidth * PrintScale.CSS_DPI / 25.4;
    var cssHeight = p.imageHeight * PrintScale.CSS_DPI / 25.4;
    var maxDpi = Math.floor(Math.min(
        maxSize * PrintScale.CSS_DPI / Math.max(Math.ceil(cssWidth), Math.ceil(cssHeight)),
        Math.sqrt(64000000 / (p.imageWidth * p.imageHeight)) * 25.4,
        Math.sqrt(256000000 / (p.imageWidth * p.imageHeight * p.pages.length)) * 25.4));
    if (PrintScale.positive(dpi) && (dpi > maxDpi || Math.min(p.imageWidth, p.imageHeight) * dpi / 25.4 < 1)) {
        errors.dpi.state = true;
        errors.dpi.msg = 'Bitte eine Auflösung von mindestens einem Pixel pro Blatt und höchstens ' +
            maxDpi + ' DPI für dieses Raster wählen (Geräte- und Speichergrenzen).';
    }
    if (map && scaleController) {
        var width = p.width * PrintScale.CSS_DPI / 25.4;
        var height = p.height * PrintScale.CSS_DPI / 25.4;
        var fit = Math.min(1, 960 / width, 700 / height,
            maxSize / (Math.max(width, height) * window.devicePixelRatio));
        // Integer viewport dimensions use one common physical scale in both axes.
        var previewWidth = Math.max(1, Math.floor(width * fit));
        scaleController.viewportScale = previewWidth / width;
        map.getContainer().style.width = previewWidth + 'px';
        map.getContainer().style.height = Math.max(1, Math.round(height * scaleController.viewportScale)) + 'px';
        map.resize();
        scaleController.update();
    }
}
form.widthInput.addEventListener('change', validateDimensions);
form.heightInput.addEventListener('change', validateDimensions);
form.dpiInput.addEventListener('change', validateDimensions);
form.styleSelect.addEventListener('change', function() {
    try { map.setStyle(form.styleSelect.value); }
    catch (e) { openErrorModal('Error changing style: ' + e.message); }
    updateAttribution();
});
form.mmUnit.addEventListener('change', function() {
    form.widthInput.value = Number(form.widthInput.value) * 25.4;
    form.heightInput.value = Number(form.heightInput.value) * 25.4;
    validateDimensions();
});
form.inUnit.addEventListener('change', function() {
    form.widthInput.value = Number(form.widthInput.value) / 25.4;
    form.heightInput.value = Number(form.heightInput.value) / 25.4;
    validateDimensions();
});

function applyScale() {
    var value = Number(form.scaleInput.value);
    if (!PrintScale.positive(value)) {
        errors.scale.state = true;
        errors.scale.msg = 'Bitte einen endlichen, positiven Maßstabsnenner eingeben.';
        handleErrors();
        drawPreviewBar();
        return;
    }
    if (scaleInputDirty) {
        scaleInputDirty = false;
        scaleController.setTarget(value);
    }
}
form.scaleInput.addEventListener('input', function() {
    scaleInputDirty = true;
    errors.scale.state = !PrintScale.positive(Number(form.scaleInput.value));
    errors.scale.msg = 'Bitte einen endlichen, positiven Maßstabsnenner eingeben.';
    handleErrors();
    drawPreviewBar();
});
form.scaleInput.addEventListener('change', applyScale);
form.scalePreset.addEventListener('change', function() {
    if (!form.scalePreset.value) return;
    form.scaleInput.value = form.scalePreset.value;
    scaleInputDirty = true;
    applyScale();
});
form.scaleBarInput.addEventListener('change', drawPreviewBar);

function changeCoordinate(event) {
    var latChanged = event.target === form.latInput;
    var value = Number(event.target.value);
    var error = errors[latChanged ? 'latitude' : 'longitude'];
    error.state = event.target.value.trim() === '' || !Number.isFinite(value) ||
        (latChanged && Math.abs(value) > PrintScale.MAX_LATITUDE);
    error.msg = latChanged ? 'Latitude must be between -85.051129 and 85.051129 degrees.' :
        'Longitude must be a finite number.';
    if (!error.state) {
        var center = map.getCenter();
        map.jumpTo({center: latChanged ? [center.lng, value] : [value, center.lat], pitch: 0});
    }
    handleErrors();
}
form.latInput.addEventListener('change', changeCoordinate);
form.lonInput.addEventListener('change', changeCoordinate);

function drawPreviewBar() {
    if (!previewBar || !scaleController) return;
    var visible = form.scaleBarInput.checked && scaleController.valid && !errors.scale.state;
    previewBar.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    var container = map.getContainer();
    var ratio = window.devicePixelRatio;
    previewBar.width = Math.round(container.clientWidth * ratio);
    previewBar.height = Math.round(container.clientHeight * ratio);
    PrintScale.drawBar(previewBar.getContext('2d'), previewBar.width, previewBar.height,
        PrintScale.scaleFromZoom(map.getCenter().lat, map.getZoom()) * scaleController.viewportScale,
        PrintScale.CSS_DPI * ratio * scaleController.viewportScale);
}

function drawPreviewGrid() {
    if (!previewGrid) return;
    previewGrid.style.display = sheetMode() && posterLayout ? 'block' : 'none';
    if (!sheetMode() || !posterLayout) return;
    var p = posterLayout, ratio = window.devicePixelRatio;
    previewGrid.width = Math.round(map.getContainer().clientWidth * ratio);
    previewGrid.height = Math.round(map.getContainer().clientHeight * ratio);
    var context = previewGrid.getContext('2d');
    var xScale = previewGrid.width / p.width, yScale = previewGrid.height / p.height;
    context.fillStyle = 'rgba(255, 196, 0, 0.24)';
    p.pages.forEach(function(page) {
        if (page.column > 0) context.fillRect(page.x * xScale, page.y * yScale,
            p.overlap * xScale, p.imageHeight * yScale);
        if (page.row > 0) context.fillRect(page.x * xScale, page.y * yScale,
            p.imageWidth * xScale, p.overlap * yScale);
    });
    context.strokeStyle = '#23527c';
    context.lineWidth = ratio;
    context.setLineDash([5 * ratio, 3 * ratio]);
    context.font = 12 * ratio + 'px sans-serif';
    p.pages.forEach(function(page) {
        context.strokeRect(page.x * xScale + ratio / 2, page.y * yScale + ratio / 2,
            p.imageWidth * xScale - ratio, p.imageHeight * yScale - ratio);
        var x = (page.x + p.imageWidth) * xScale - 54 * ratio;
        var y = (page.y + p.imageHeight) * yScale - 22 * ratio;
        context.fillStyle = 'rgba(255,255,255,0.9)';
        context.fillRect(x, y, 50 * ratio, 18 * ratio);
        context.fillStyle = '#23527c';
        context.fillText(page.label, x + 3 * ratio, y + 13 * ratio);
    });
}

var origBodyPaddingRight;
function openErrorModal(msg) {
    var modal = document.getElementById('errorModal');
    document.getElementById('modal-error-text').textContent = msg;
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
    document.getElementById('modalBackdrop').style.height = modal.scrollHeight + 'px';
    document.getElementById('modalBackdrop').style.display = 'block';
    if (document.body.scrollHeight > document.documentElement.clientHeight) {
        origBodyPaddingRight = document.body.style.paddingRight;
        var padding = parseInt((document.body.style.paddingRight || 0), 10);
        document.body.style.paddingRight = padding + measureScrollbar() + 'px';
    }
}
function closeErrorModal() {
    document.getElementById('errorModal').style.display = 'none';
    document.getElementById('modalBackdrop').style.display = 'none';
    document.body.classList.remove('modal-open');
    document.body.style.paddingRight = origBodyPaddingRight;
}
function measureScrollbar() {
    var scrollDiv = document.createElement('div');
    scrollDiv.className = 'modal-scrollbar-measure';
    document.body.appendChild(scrollDiv);
    var width = scrollDiv.offsetWidth - scrollDiv.clientWidth;
    scrollDiv.parentNode.removeChild(scrollDiv);
    return width;
}

// High-resolution rendering: snapshot the camera, then composite on a separate
// 2D canvas. Both output formats use exactly this composited image.
document.getElementById('generate-btn').addEventListener('click', generateMap);
function generateMap() {
    if (exporting || !map || !scaleController || scaleController.target === null) return;
    applyScale();
    validateDimensions();
    map.stop();
    scaleController.update(); // Flush the scale correction before taking a snapshot.
    if (isError()) {
        openErrorModal('The current configuration is invalid! Please correct the errors and try again.');
        return;
    }
    var settings = {
        width: Number(form.widthInput.value), height: Number(form.heightInput.value),
        dpi: Number(form.dpiInput.value), unit: unit(),
        format: form.outputOptions[0].checked ? 'png' : 'pdf',
        style: form.styleSelect.value, bar: form.scaleBarInput.checked,
        center: {lng: map.getCenter().lng, lat: map.getCenter().lat},
        scale: scaleController.target, bearing: map.getBearing(),
        minZoom: map.getMinZoom(), maxZoom: map.getMaxZoom()
    };
    if (sheetMode()) {
        settings.poster = posterLayout;
        settings.format = 'pdf';
    }
    exporting = true;
    form.querySelector('fieldset').disabled = true;
    map.getContainer().classList.add('exporting');
    document.getElementById('spinner').style.display = 'inline-block';
    handleErrors();
    document.getElementById('export-status').textContent = 'Karte wird gerendert …';
    return Promise.resolve().then(function() {
        return settings.poster ? createTiledPrintMap(settings) : createPrintMap(settings);
    }).then(function() {
        document.getElementById('export-status').textContent = settings.poster ?
            'PDF mit ' + settings.poster.pages.length + ' Seiten erstellt.' : 'Export erstellt.';
    }).catch(function(error) {
        document.getElementById('export-status').textContent = 'Export abgebrochen.';
        openErrorModal('Export fehlgeschlagen: ' + error.message);
    }).finally(function() {
        exporting = false;
        form.querySelector('fieldset').disabled = false;
        map.getContainer().classList.remove('exporting');
        document.getElementById('spinner').style.display = 'none';
        handleErrors();
        drawPreviewBar();
        drawPreviewGrid();
    });
}

// Render one physical rectangle, then release its WebGL context before the next
// sheet. Crop a rounded-up viewport instead of stretching an integer CSS size.
function renderPrintCanvas(settings) {
    return new Promise(function(resolve, reject) {
        var descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
        var renderMap, hidden, timeout, output, finished = false;
        function finish(error, result) {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            try {
                if (renderMap) renderMap.remove();
            } catch (cleanupError) { error = error || cleanupError; }
            finally {
                if (hidden && hidden.parentNode) hidden.parentNode.removeChild(hidden);
                if (descriptor) Object.defineProperty(window, 'devicePixelRatio', descriptor);
                else delete window.devicePixelRatio;
            }
            if (error) {
                if (output) output.width = output.height = 0;
                reject(error);
            } else resolve(result);
        }
        try {
            var widthIn = settings.unit === 'mm' ? settings.width / 25.4 : settings.width;
            var heightIn = settings.unit === 'mm' ? settings.height / 25.4 : settings.height;
            var cssWidth = widthIn * PrintScale.CSS_DPI;
            var cssHeight = heightIn * PrintScale.CSS_DPI;
            Object.defineProperty(window, 'devicePixelRatio', {
                configurable: true, get: function() { return settings.dpi / PrintScale.CSS_DPI; }
            });
            hidden = document.createElement('div');
            hidden.className = 'hidden-map';
            document.body.appendChild(hidden);
            var container = document.createElement('div');
            container.style.width = Math.ceil(cssWidth) + 'px';
            container.style.height = Math.ceil(cssHeight) + 'px';
            hidden.appendChild(container);
            var zoom = settings.zoom === undefined ?
                PrintScale.zoomFromScale(settings.center.lat, settings.scale) : settings.zoom;
            if (zoom < settings.minZoom || zoom > settings.maxZoom) {
                throw new Error('Maßstab liegt für dieses Papierformat an einer Zoomgrenze.');
            }
            renderMap = new mapboxgl.Map({
                container: container, center: settings.center, zoom: zoom,
                minZoom: settings.minZoom, maxZoom: settings.maxZoom,
                style: settings.style, bearing: settings.bearing, pitch: 0,
                interactive: false, preserveDrawingBuffer: true,
                fadeDuration: 0, attributionControl: false
            });
            timeout = setTimeout(function() { finish(new Error('Zeitüberschreitung beim Kartenrendering.')); }, 45000);
            renderMap.on('error', function(event) { finish(event.error || new Error('Kartenressource nicht verfügbar.')); });
            renderMap.once('idle', function() {
                if (finished) return;
                try {
                    var center = renderMap.getCenter();
                    if (Math.abs(renderMap.getZoom() - zoom) > 1e-7 ||
                            Math.abs(center.lat - settings.center.lat) > 1e-7 ||
                            Math.abs(((center.lng - settings.center.lng + 540) % 360) - 180) > 1e-7) {
                        throw new Error('Die Exportkamera kann das Kartenraster nicht unverändert darstellen. Bitte Ort oder Maßstab ändern.');
                    }
                    output = document.createElement('canvas');
                    output.width = Math.round(widthIn * settings.dpi);
                    output.height = Math.round(heightIn * settings.dpi);
                    var context = output.getContext('2d');
                    if (!context) throw new Error('2D-Canvas konnte nicht erstellt werden.');
                    var source = renderMap.getCanvas();
                    var cropWidth = cssWidth * source.width / container.clientWidth;
                    var cropHeight = cssHeight * source.height / container.clientHeight;
                    context.drawImage(source, (source.width - cropWidth) / 2, (source.height - cropHeight) / 2,
                        cropWidth, cropHeight, 0, 0, output.width, output.height);
                    var actualScale = PrintScale.scaleFromZoom(center.lat, renderMap.getZoom());
                    if (settings.bar) PrintScale.drawBar(context, output.width, output.height,
                        settings.barScale || actualScale, settings.dpi);
                    finish(null, {canvas: output, scale: actualScale, center: center,
                        zoom: renderMap.getZoom(), name: renderMap.getStyle().name || 'Print Maps'});
                } catch (error) { finish(error); }
            });
        } catch (error) { finish(error); }
    });
}

function setPdfProperties(pdf, settings, name) {
    pdf.setProperties({
        title: name,
        subject: 'center: [' + settings.center.lng + ', ' + settings.center.lat +
            '], local scale at poster center 1:' + settings.scale +
            (settings.poster ? ', ' + settings.poster.columns + 'x' + settings.poster.rows +
                ' sheets, overlap 15 mm' : ''),
        creator: 'Print Maps',
        author: '(c) ' + (settings.style.indexOf('mapbox') >= 0 ? 'Mapbox' : 'Stadia Maps') +
            ', (c) OpenStreetMap'
    });
}

function createPrintMap(settings) {
    return renderPrintCanvas(settings).then(function(result) {
        var output = result.canvas;
        return Promise.resolve().then(function() {
            if (settings.format === 'png') {
                return new Promise(function(resolve, reject) {
                    output.toBlob(function(blob) {
                        try {
                            if (!blob) throw new Error('PNG konnte nicht erstellt werden.');
                            saveAs(blob, 'map.png');
                            resolve();
                        } catch (error) { reject(error); }
                    }, 'image/png');
                });
            }
            var pdf = new jsPDF({orientation: settings.width > settings.height ? 'l' : 'p',
                unit: settings.unit, format: [settings.width, settings.height], compress: true});
            pdf.addImage(output.toDataURL('image/png'), 'png', 0, 0,
                settings.width, settings.height, null, 'FAST');
            setPdfProperties(pdf, settings, result.name);
            pdf.save('map.pdf');
        }).finally(function() { output.width = output.height = 0; });
    });
}

function createTiledPrintMap(settings) {
    var p = settings.poster;
    var zoom = PrintScale.zoomFromScale(settings.center.lat, settings.scale);
    var pdf = new jsPDF({orientation: p.orientation === 'landscape' ? 'l' : 'p',
        unit: 'mm', format: [p.pageWidth, p.pageHeight], compress: true});
    var attribution = settings.style.indexOf('mapbox') >= 0 ?
        '(c) Mapbox | (c) OpenStreetMap' : '(c) Stadia Maps | (c) OpenMapTiles | (c) OpenStreetMap';
    // Sequential rendering bounds live canvas memory and uses the same world
    // zoom/bearing for every page, including the duplicated overlap strips.
    var chain = Promise.resolve();
    p.pages.forEach(function(page) {
        chain = chain.then(function() {
            document.getElementById('export-status').textContent = 'Blatt ' + page.number +
                ' von ' + p.pages.length + ' wird gerendert (' + page.label + ') …';
            return renderPrintCanvas({width: p.imageWidth, height: p.imageHeight,
                unit: 'mm', dpi: settings.dpi, style: settings.style, bar: settings.bar && page.number === 1,
                barScale: settings.scale,
                center: PrintTiles.pageCenter(p, page, settings.center, zoom, settings.bearing),
                zoom: zoom, scale: settings.scale, bearing: settings.bearing,
                minZoom: settings.minZoom, maxZoom: settings.maxZoom});
        }).then(function(result) {
            try {
                if (page.number > 1) pdf.addPage([p.pageWidth, p.pageHeight], p.orientation === 'landscape' ? 'l' : 'p');
                pdf.addImage(result.canvas.toDataURL('image/png'), 'png', p.margin, p.margin,
                    p.imageWidth, p.imageHeight, 'sheet-' + page.number, 'FAST');
                PrintTiles.drawMarks(pdf, p, page, attribution);
                setPdfProperties(pdf, settings, result.name);
            } finally { result.canvas.width = result.canvas.height = 0; }
        });
    });
    return chain.then(function() {
        pdf.save('map-' + p.columns + 'x' + p.rows + '-' + p.format + '.pdf');
    });
}
updateSizeMode();
