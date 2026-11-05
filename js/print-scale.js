/* Local, flat Mercator print scale. No build step; also usable by Node tests. */
(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PrintScale = api;
}(typeof window === 'undefined' ? this : window, function() {
    'use strict';

    var CSS_DPI = 96;
    // Match Mapbox GL 1.13's rounded Mercator clamp, including its endpoints.
    var MAX_LATITUDE = 85.051129;
    var METRES_PER_TILE = 40075016.68557849 / 512;

    function positive(value) { return Number.isFinite(value) && value > 0; }
    function factor(latitude) {
        if (!Number.isFinite(latitude) || Math.abs(latitude) > MAX_LATITUDE) return NaN;
        return METRES_PER_TILE * Math.cos(latitude * Math.PI / 180) * CSS_DPI / 0.0254;
    }
    function scaleFromZoom(latitude, zoom) { return factor(latitude) / Math.pow(2, zoom); }
    function zoomFromScale(latitude, scale) {
        return positive(scale) ? Math.log2(factor(latitude) / scale) : NaN;
    }
    function formatScale(scale) {
        return scale.toLocaleString('de-DE', {maximumFractionDigits: scale < 10 ? 2 : 0});
    }
    function distancePixels(distance, scale, dpi) { return distance / scale * dpi / 0.0254; }
    function niceDistance(maximum) {
        if (!positive(maximum)) return 0;
        var power = Math.pow(10, Math.floor(Math.log10(maximum)));
        var n = maximum / power;
        return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
    }
    function formatDistance(distance) {
        var value = distance >= 1000 ? distance / 1000 : distance;
        return value.toLocaleString('de-DE', {maximumSignificantDigits: 3}) +
            (distance >= 1000 ? ' km' : ' m');
    }

    // All geometry is in physical mm. Tiny sheets shrink the furniture as a
    // whole; the distance is then reselected, never stretched independently.
    function barLayout(widthMm, heightMm, scale) {
        if (!positive(widthMm) || !positive(heightMm) || !positive(scale)) return null;
        var size = Math.min(1, widthMm / 65, heightMm / 23);
        var margin = 3 * size, padding = 2 * size;
        var font = 2.8 * size;
        var ratio = '1 : ' + formatScale(scale);
        var barLimit = Math.min(50, widthMm - 2 * margin - 2 * padding - 12 * size);
        var distance = niceDistance(barLimit * scale / 1000);
        var length = distance / scale * 1000;
        var label = formatDistance(distance);
        // Conservative text widths; draw() measures the actual font as well.
        var panelWidth = Math.max(length + 2 * padding,
            (ratio.length + 1) * font * 0.65 + 2 * padding,
            (label.length + 2) * font * 0.65 + 2 * padding);
        var fit = Math.min(1, (widthMm - 2 * margin) / panelWidth);
        return {x: margin, y: margin, width: panelWidth * fit,
            height: 14 * size * fit, font: font * fit, padding: padding * fit,
            thickness: 1.5 * size * fit, line: 0.22 * size * fit,
            // If text forces extra shrinking, keep the distance physically true.
            distance: distance, length: length, ratio: ratio, label: label};
    }

    function drawBar(context, width, height, scale, dpi) {
        var mm = dpi / 25.4;
        var layout = barLayout(width / mm, height / mm, scale);
        if (!layout) return null;
        context.save();
        context.scale(mm, mm);
        context.translate(layout.x, layout.y);
        context.font = layout.font + 'px sans-serif';
        context.textBaseline = 'top';
        var p = layout.padding;
        var textWidth = Math.max(context.measureText(layout.ratio).width,
            context.measureText('0   ' + layout.label).width);
        var panelWidth = Math.max(layout.width, textWidth + 2 * p, layout.length + 2 * p);
        context.fillStyle = 'rgba(255,255,255,0.9)';
        context.fillRect(0, 0, panelWidth, layout.height);
        context.fillStyle = '#111';
        context.fillText(layout.ratio, p, p);
        var y = p + layout.font + 1.3 * layout.font;
        context.fillText('0', p, p + layout.font + 0.3 * layout.font);
        context.textAlign = 'right';
        context.fillText(layout.label, p + Math.max(layout.length, textWidth),
            p + layout.font + 0.3 * layout.font);
        context.fillStyle = '#fff';
        context.fillRect(p, y, layout.length, layout.thickness);
        context.fillStyle = '#111';
        context.fillRect(p, y, layout.length / 2, layout.thickness);
        context.lineWidth = layout.line;
        context.strokeStyle = '#111';
        context.strokeRect(p, y, layout.length, layout.thickness);
        context.restore();
        return layout;
    }

    function Controller(map, onChange) {
        this.map = map;
        this.onChange = onChange || function() {};
        this.target = null;
        this.correcting = false;
        this.valid = false;
        var self = this;
        map.on('move', function(event) { self.update(event); });
        map.on('moveend', function(event) { self.update(event); });
        map.on('load', function() { self.initialize(); });
    }
    Controller.prototype.initialize = function() {
        if (this.target !== null) return;
        this.target = scaleFromZoom(this.map.getCenter().lat, this.map.getZoom());
        this.update(null, 'initialize');
    };
    Controller.prototype.setTarget = function(scale) {
        if (!positive(scale)) return false;
        this.target = scale;
        this.update(null, 'input');
        return this.valid;
    };
    Controller.prototype.update = function(event, reason) {
        if (this.correcting || this.target === null) return;
        var map = this.map;
        // In 1.13 the first isolated wheel event can lose originalEvent in
        // ScrollZoomHandler's 40ms device-detection timeout. The handler state
        // still distinguishes that gesture from a programmatic camera flight.
        var wheelZoom = map.scrollZoom && map.scrollZoom.isZooming();
        var userZoom = event && map.isZooming() && (event.originalEvent || wheelZoom);
        if (userZoom) {
            // Includes pinch+pan, wheel around a point, navigation buttons and
            // their inertia. A programmatic flyTo has no originalEvent.
            this.target = scaleFromZoom(map.getCenter().lat, map.getZoom());
            reason = 'userZoom';
        }
        this.correcting = true;
        try {
            // Mapbox GL 1.13 jumpTo/setZoom stop active gesture handlers. Its
            // Transform setters instead update the current frame without events
            // or animations. Keep this adapter version-pinned and browser-tested.
            var transform = map.transform;
            var anchor, location;
            var original = event && event.originalEvent;
            if (!userZoom && original && (original.type === 'mousemove' ||
                    (original.type === 'touchmove' && original.touches.length === 1))) {
                var pointer = original.touches ? original.touches[0] : original;
                var rect = map.getCanvas().getBoundingClientRect();
                var point = [pointer.clientX - rect.left, pointer.clientY - rect.top];
                location = map.unproject(point);
                anchor = map.project(location);
            }
            for (var i = 0; i < 12; i++) {
                var zoom = zoomFromScale(map.getCenter().lat, this.target);
                var limited = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));
                if (Math.abs(map.getZoom() - limited) < 1e-10 && map.getPitch() === 0) break;
                transform.pitch = 0;
                transform.zoom = limited;
                if (anchor) transform.setLocationAtPoint(location, anchor);
            }
            var actual = scaleFromZoom(map.getCenter().lat, map.getZoom());
            this.valid = positive(actual) && Math.abs(actual / this.target - 1) < 1e-7;
            this.actual = actual;
            // Re-evaluate zoom-dependent paint and tile coverage as well as
            // repainting. triggerRepaint alone would retain stale style/tiles
            // when a scale is entered without a move/zoom event.
            map._update(true);
        } finally {
            this.correcting = false;
        }
        this.onChange({target: this.target, actual: this.actual,
            valid: this.valid, reason: reason});
    };

    return {CSS_DPI: CSS_DPI, MAX_LATITUDE: MAX_LATITUDE, positive: positive,
        scaleFromZoom: scaleFromZoom, zoomFromScale: zoomFromScale,
        formatScale: formatScale, distancePixels: distancePixels,
        niceDistance: niceDistance, barLayout: barLayout, drawBar: drawBar,
        Controller: Controller};
}));
