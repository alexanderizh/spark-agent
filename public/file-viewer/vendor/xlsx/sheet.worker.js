//#region node_modules/.pnpm/styled-exceljs@0.21.1/node_modules/styled-exceljs/xlsx.mjs
var e = {};
e.version = "0.21.1";
var t = 1200, n = 1252, r, i = [
	874,
	932,
	936,
	949,
	950,
	1250,
	1251,
	1252,
	1253,
	1254,
	1255,
	1256,
	1257,
	1258,
	1e4
], a = {
	0: 1252,
	1: 65001,
	2: 65001,
	77: 1e4,
	128: 932,
	129: 949,
	130: 1361,
	134: 936,
	136: 950,
	161: 1253,
	162: 1254,
	163: 1258,
	177: 1255,
	178: 1256,
	186: 1257,
	204: 1251,
	222: 874,
	238: 1250,
	255: 1252,
	69: 6969
}, o = function(e) {
	i.indexOf(e) != -1 && (n = a[0] = e);
};
function s() {
	o(1252);
}
var c = function(e) {
	t = e, o(e);
};
function l() {
	c(1200), s();
}
function u(e) {
	for (var t = [], n = 0, r = e.length; n < r; ++n) t[n] = e.charCodeAt(n);
	return t;
}
function d(e) {
	for (var t = [], n = 0; n < e.length >> 1; ++n) t[n] = String.fromCharCode(e.charCodeAt(2 * n) + (e.charCodeAt(2 * n + 1) << 8));
	return t.join("");
}
function f(e) {
	for (var t = [], n = 0; n < e.length >> 1; ++n) t[n] = String.fromCharCode(e[2 * n] + (e[2 * n + 1] << 8));
	return t.join("");
}
function p(e) {
	for (var t = [], n = 0; n < e.length >> 1; ++n) t[n] = String.fromCharCode(e.charCodeAt(2 * n + 1) + (e.charCodeAt(2 * n) << 8));
	return t.join("");
}
var m = function(e) {
	var t = e.charCodeAt(0), n = e.charCodeAt(1);
	return t == 255 && n == 254 ? d(e.slice(2)) : t == 254 && n == 255 ? p(e.slice(2)) : t == 65279 ? e.slice(1) : e;
}, h = function(e) {
	return String.fromCharCode(e);
}, g = function(e) {
	return String.fromCharCode(e);
}, _ = null, v = !0, y = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function b(e) {
	for (var t = "", n = 0, r = 0, i = 0, a = 0, o = 0, s = 0, c = 0, l = 0; l < e.length;) n = e.charCodeAt(l++), a = n >> 2, r = e.charCodeAt(l++), o = (n & 3) << 4 | r >> 4, i = e.charCodeAt(l++), s = (r & 15) << 2 | i >> 6, c = i & 63, isNaN(r) ? s = c = 64 : isNaN(i) && (c = 64), t += y.charAt(a) + y.charAt(o) + y.charAt(s) + y.charAt(c);
	return t;
}
function x(e) {
	for (var t = "", n = 0, r = 0, i = 0, a = 0, o = 0, s = 0, c = 0, l = 0; l < e.length;) n = e[l++], a = n >> 2, r = e[l++], o = (n & 3) << 4 | r >> 4, i = e[l++], s = (r & 15) << 2 | i >> 6, c = i & 63, isNaN(r) ? s = c = 64 : isNaN(i) && (c = 64), t += y.charAt(a) + y.charAt(o) + y.charAt(s) + y.charAt(c);
	return t;
}
function S(e) {
	var t = "", n = 0, r = 0, i = 0, a = 0, o = 0, s = 0, c = 0;
	if (e.slice(0, 5) == "data:") {
		var l = e.slice(0, 1024).indexOf(";base64,");
		l > -1 && (e = e.slice(l + 8));
	}
	e = e.replace(/[^\w\+\/\=]/g, "");
	for (var l = 0; l < e.length;) a = y.indexOf(e.charAt(l++)), o = y.indexOf(e.charAt(l++)), n = a << 2 | o >> 4, t += String.fromCharCode(n), s = y.indexOf(e.charAt(l++)), r = (o & 15) << 4 | s >> 2, s !== 64 && (t += String.fromCharCode(r)), c = y.indexOf(e.charAt(l++)), i = (s & 3) << 6 | c, c !== 64 && (t += String.fromCharCode(i));
	return t;
}
var C = /*#__PURE__*/ (function() {
	return typeof Buffer < "u" && typeof process < "u" && process.versions !== void 0 && !!process.versions.node;
})(), w = /*#__PURE__*/ (function() {
	if (typeof Buffer < "u") {
		var e = !Buffer.from;
		if (!e) try {
			Buffer.from("foo", "utf8");
		} catch {
			e = !0;
		}
		return e ? function(e, t) {
			return t ? new Buffer(e, t) : new Buffer(e);
		} : Buffer.from.bind(Buffer);
	}
	return function() {};
})(), T = /*#__PURE__*/ (function() {
	if (typeof Buffer > "u") return !1;
	var e = w([65, 0]);
	return e ? e.toString("utf16le").length == 1 : !1;
})();
function E(e) {
	return C ? Buffer.alloc ? Buffer.alloc(e) : new Buffer(e) : typeof Uint8Array < "u" ? new Uint8Array(e) : Array(e);
}
function D(e) {
	return C ? Buffer.allocUnsafe ? Buffer.allocUnsafe(e) : new Buffer(e) : typeof Uint8Array < "u" ? new Uint8Array(e) : Array(e);
}
var O = function(e) {
	return C ? w(e, "binary") : e.split("").map(function(e) {
		return e.charCodeAt(0) & 255;
	});
};
function k(e) {
	if (Array.isArray(e)) return e.map(function(e) {
		return String.fromCharCode(e);
	}).join("");
	for (var t = [], n = 0; n < e.length; ++n) t[n] = String.fromCharCode(e[n]);
	return t.join("");
}
function A(e) {
	if (typeof ArrayBuffer > "u") throw Error("Unsupported");
	if (e instanceof ArrayBuffer) return A(new Uint8Array(e));
	for (var t = Array(e.length), n = 0; n < e.length; ++n) t[n] = e[n];
	return t;
}
var j = C ? function(e) {
	return Buffer.concat(e.map(function(e) {
		return Buffer.isBuffer(e) ? e : w(e);
	}));
} : function(e) {
	if (typeof Uint8Array < "u") {
		var t = 0, n = 0;
		for (t = 0; t < e.length; ++t) n += e[t].length;
		var r = new Uint8Array(n), i = 0;
		for (t = 0, n = 0; t < e.length; n += i, ++t) i = e[t].length, e[t] instanceof Uint8Array ? r.set(e[t], n) : typeof e[t] == "string" ? r.set(new Uint8Array(O(e[t])), n) : r.set(new Uint8Array(e[t]), n);
		return r;
	}
	return [].concat.apply([], e.map(function(e) {
		return Array.isArray(e) ? e : [].slice.call(e);
	}));
};
function ee(e) {
	for (var t = [], n = 0, r = e.length + 250, i = E(e.length + 255), a = 0; a < e.length; ++a) {
		var o = e.charCodeAt(a);
		if (o < 128) i[n++] = o;
		else if (o < 2048) i[n++] = 192 | o >> 6 & 31, i[n++] = 128 | o & 63;
		else if (o >= 55296 && o < 57344) {
			o = (o & 1023) + 64;
			var s = e.charCodeAt(++a) & 1023;
			i[n++] = 240 | o >> 8 & 7, i[n++] = 128 | o >> 2 & 63, i[n++] = 128 | s >> 6 & 15 | (o & 3) << 4, i[n++] = 128 | s & 63;
		} else i[n++] = 224 | o >> 12 & 15, i[n++] = 128 | o >> 6 & 63, i[n++] = 128 | o & 63;
		n > r && (t.push(i.slice(0, n)), n = 0, i = E(65535), r = 65530);
	}
	return t.push(i.slice(0, n)), j(t);
}
var M = /\u0000/g, N = /[\u0001-\u0006]/g;
function P(e) {
	for (var t = "", n = e.length - 1; n >= 0;) t += e.charAt(n--);
	return t;
}
function F(e, t) {
	var n = "" + e;
	return n.length >= t ? n : _t("0", t - n.length) + n;
}
function I(e, t) {
	var n = "" + e;
	return n.length >= t ? n : _t(" ", t - n.length) + n;
}
function L(e, t) {
	var n = "" + e;
	return n.length >= t ? n : n + _t(" ", t - n.length);
}
function te(e, t) {
	var n = "" + Math.round(e);
	return n.length >= t ? n : _t("0", t - n.length) + n;
}
function ne(e, t) {
	var n = "" + e;
	return n.length >= t ? n : _t("0", t - n.length) + n;
}
var re = 2 ** 32;
function R(e, t) {
	return e > re || e < -re ? te(e, t) : ne(Math.round(e), t);
}
function z(e, t) {
	return t = t || 0, e.length >= 7 + t && (e.charCodeAt(t) | 32) == 103 && (e.charCodeAt(t + 1) | 32) == 101 && (e.charCodeAt(t + 2) | 32) == 110 && (e.charCodeAt(t + 3) | 32) == 101 && (e.charCodeAt(t + 4) | 32) == 114 && (e.charCodeAt(t + 5) | 32) == 97 && (e.charCodeAt(t + 6) | 32) == 108;
}
var B = [
	["Sun", "Sunday"],
	["Mon", "Monday"],
	["Tue", "Tuesday"],
	["Wed", "Wednesday"],
	["Thu", "Thursday"],
	["Fri", "Friday"],
	["Sat", "Saturday"]
], ie = [
	[
		"J",
		"Jan",
		"January"
	],
	[
		"F",
		"Feb",
		"February"
	],
	[
		"M",
		"Mar",
		"March"
	],
	[
		"A",
		"Apr",
		"April"
	],
	[
		"M",
		"May",
		"May"
	],
	[
		"J",
		"Jun",
		"June"
	],
	[
		"J",
		"Jul",
		"July"
	],
	[
		"A",
		"Aug",
		"August"
	],
	[
		"S",
		"Sep",
		"September"
	],
	[
		"O",
		"Oct",
		"October"
	],
	[
		"N",
		"Nov",
		"November"
	],
	[
		"D",
		"Dec",
		"December"
	]
];
function ae(e) {
	return e || (e = {}), e[0] = "General", e[1] = "0", e[2] = "0.00", e[3] = "#,##0", e[4] = "#,##0.00", e[9] = "0%", e[10] = "0.00%", e[11] = "0.00E+00", e[12] = "# ?/?", e[13] = "# ??/??", e[14] = "m/d/yy", e[15] = "d-mmm-yy", e[16] = "d-mmm", e[17] = "mmm-yy", e[18] = "h:mm AM/PM", e[19] = "h:mm:ss AM/PM", e[20] = "h:mm", e[21] = "h:mm:ss", e[22] = "m/d/yy h:mm", e[37] = "#,##0 ;(#,##0)", e[38] = "#,##0 ;[Red](#,##0)", e[39] = "#,##0.00;(#,##0.00)", e[40] = "#,##0.00;[Red](#,##0.00)", e[45] = "mm:ss", e[46] = "[h]:mm:ss", e[47] = "mmss.0", e[48] = "##0.0E+0", e[49] = "@", e[56] = "\"上午/下午 \"hh\"時\"mm\"分\"ss\"秒 \"", e;
}
var V = {
	0: "General",
	1: "0",
	2: "0.00",
	3: "#,##0",
	4: "#,##0.00",
	9: "0%",
	10: "0.00%",
	11: "0.00E+00",
	12: "# ?/?",
	13: "# ??/??",
	14: "m/d/yy",
	15: "d-mmm-yy",
	16: "d-mmm",
	17: "mmm-yy",
	18: "h:mm AM/PM",
	19: "h:mm:ss AM/PM",
	20: "h:mm",
	21: "h:mm:ss",
	22: "m/d/yy h:mm",
	37: "#,##0 ;(#,##0)",
	38: "#,##0 ;[Red](#,##0)",
	39: "#,##0.00;(#,##0.00)",
	40: "#,##0.00;[Red](#,##0.00)",
	45: "mm:ss",
	46: "[h]:mm:ss",
	47: "mmss.0",
	48: "##0.0E+0",
	49: "@",
	56: "\"上午/下午 \"hh\"時\"mm\"分\"ss\"秒 \""
}, oe = {
	5: 37,
	6: 38,
	7: 39,
	8: 40,
	23: 0,
	24: 0,
	25: 0,
	26: 0,
	27: 14,
	28: 14,
	29: 14,
	30: 14,
	31: 14,
	50: 14,
	51: 14,
	52: 14,
	53: 14,
	54: 14,
	55: 14,
	56: 14,
	57: 14,
	58: 14,
	59: 1,
	60: 2,
	61: 3,
	62: 4,
	67: 9,
	68: 10,
	69: 12,
	70: 13,
	71: 14,
	72: 14,
	73: 15,
	74: 16,
	75: 17,
	76: 20,
	77: 21,
	78: 22,
	79: 45,
	80: 46,
	81: 47,
	82: 0
}, se = {
	5: "\"$\"#,##0_);\\(\"$\"#,##0\\)",
	63: "\"$\"#,##0_);\\(\"$\"#,##0\\)",
	6: "\"$\"#,##0_);[Red]\\(\"$\"#,##0\\)",
	64: "\"$\"#,##0_);[Red]\\(\"$\"#,##0\\)",
	7: "\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)",
	65: "\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)",
	8: "\"$\"#,##0.00_);[Red]\\(\"$\"#,##0.00\\)",
	66: "\"$\"#,##0.00_);[Red]\\(\"$\"#,##0.00\\)",
	41: "_(* #,##0_);_(* \\(#,##0\\);_(* \"-\"_);_(@_)",
	42: "_(\"$\"* #,##0_);_(\"$\"* \\(#,##0\\);_(\"$\"* \"-\"_);_(@_)",
	43: "_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \"-\"??_);_(@_)",
	44: "_(\"$\"* #,##0.00_);_(\"$\"* \\(#,##0.00\\);_(\"$\"* \"-\"??_);_(@_)"
};
function ce(e, t, n) {
	for (var r = e < 0 ? -1 : 1, i = e * r, a = 0, o = 1, s = 0, c = 1, l = 0, u = 0, d = Math.floor(i); l < t && (d = Math.floor(i), s = d * o + a, u = d * l + c, !(i - d < 5e-8));) i = 1 / (i - d), a = o, o = s, c = l, l = u;
	if (u > t && (l > t ? (u = c, s = a) : (u = l, s = o)), !n) return [
		0,
		r * s,
		u
	];
	var f = Math.floor(r * s / u);
	return [
		f,
		r * s - f * u,
		u
	];
}
function le(e) {
	var t = e.toPrecision(16);
	if (t.indexOf("e") > -1) {
		var n = t.slice(0, t.indexOf("e"));
		return n = n.indexOf(".") > -1 ? n.slice(0, n.slice(0, 2) == "0." ? 17 : 16) : n.slice(0, 15) + _t("0", n.length - 15), n + t.slice(t.indexOf("e"));
	}
	var r = t.indexOf(".") > -1 ? t.slice(0, t.slice(0, 2) == "0." ? 17 : 16) : t.slice(0, 15) + _t("0", t.length - 15);
	return Number(r);
}
function H(e, t, n) {
	if (e > 2958465 || e < 0) return null;
	e = le(e);
	var r = e | 0, i = Math.floor(86400 * (e - r)), a = 0, o = [], s = {
		D: r,
		T: i,
		u: 86400 * (e - r) - i,
		y: 0,
		m: 0,
		d: 0,
		H: 0,
		M: 0,
		S: 0,
		q: 0
	};
	if (Math.abs(s.u) < 1e-6 && (s.u = 0), t && t.date1904 && (r += 1462), s.u > .9999 && (s.u = 0, ++i == 86400 && (s.T = i = 0, ++r, ++s.D)), r === 60) o = n ? [
		1317,
		10,
		29
	] : [
		1900,
		2,
		29
	], a = 3;
	else if (r === 0) o = n ? [
		1317,
		8,
		29
	] : [
		1900,
		1,
		0
	], a = 6;
	else {
		r > 60 && --r;
		var c = new Date(1900, 0, 1);
		c.setDate(c.getDate() + r - 1), o = [
			c.getFullYear(),
			c.getMonth() + 1,
			c.getDate()
		], a = c.getDay(), r < 60 && (a = (a + 6) % 7), n && (a = me(c, o));
	}
	return s.y = o[0], s.m = o[1], s.d = o[2], s.S = i % 60, i = Math.floor(i / 60), s.M = i % 60, i = Math.floor(i / 60), s.H = i, s.q = a, s;
}
function ue(e) {
	return e.indexOf(".") == -1 ? e : e.replace(/(?:\.0*|(\.\d*[1-9])0+)$/, "$1");
}
function U(e) {
	return e.indexOf("E") == -1 ? e : e.replace(/(?:\.0*|(\.\d*[1-9])0+)[Ee]/, "$1E").replace(/(E[+-])(\d)$/, "$10$2");
}
function W(e) {
	var t = e < 0 ? 12 : 11, n = ue(e.toFixed(12));
	return n.length <= t || (n = e.toPrecision(10), n.length <= t) ? n : e.toExponential(5);
}
function de(e) {
	var t = ue(e.toFixed(11));
	return t.length > (e < 0 ? 12 : 11) || t === "0" || t === "-0" ? e.toPrecision(6) : t;
}
function fe(e) {
	if (!isFinite(e)) return isNaN(e) ? "#NUM!" : "#DIV/0!";
	var t = Math.floor(Math.log(Math.abs(e)) * Math.LOG10E);
	return ue(U((t >= -4 && t <= -1 ? e.toPrecision(10 + t) : Math.abs(t) <= 9 ? W(e) : t === 10 ? e.toFixed(10).substr(0, 12) : de(e)).toUpperCase()));
}
function pe(e, t) {
	switch (typeof e) {
		case "string": return e;
		case "boolean": return e ? "TRUE" : "FALSE";
		case "number": return (e | 0) === e ? e.toString(10) : fe(e);
		case "undefined": return "";
		case "object":
			if (e == null) return "";
			if (e instanceof Date) return We(14, ct(e, t && t.date1904), t);
	}
	throw Error("unsupported value in General format: " + e);
}
function me(e, t) {
	t[0] -= 581;
	var n = e.getDay();
	return e < 60 && (n = (n + 6) % 7), n;
}
function he(e, t, n, r) {
	var i = "", a = 0, o = 0, s = n.y, c, l = 0;
	switch (e) {
		case 98: s = n.y + 543;
		case 121:
			switch (t.length) {
				case 1:
				case 2:
					c = s % 100, l = 2;
					break;
				default:
					c = s % 1e4, l = 4;
					break;
			}
			break;
		case 109:
			switch (t.length) {
				case 1:
				case 2:
					c = n.m, l = t.length;
					break;
				case 3: return ie[n.m - 1][1];
				case 5: return ie[n.m - 1][0];
				default: return ie[n.m - 1][2];
			}
			break;
		case 100:
			switch (t.length) {
				case 1:
				case 2:
					c = n.d, l = t.length;
					break;
				case 3: return B[n.q][0];
				default: return B[n.q][1];
			}
			break;
		case 104:
			switch (t.length) {
				case 1:
				case 2:
					c = 1 + (n.H + 11) % 12, l = t.length;
					break;
				default: throw "bad hour format: " + t;
			}
			break;
		case 72:
			switch (t.length) {
				case 1:
				case 2:
					c = n.H, l = t.length;
					break;
				default: throw "bad hour format: " + t;
			}
			break;
		case 77:
			switch (t.length) {
				case 1:
				case 2:
					c = n.M, l = t.length;
					break;
				default: throw "bad minute format: " + t;
			}
			break;
		case 115:
			if (t != "s" && t != "ss" && t != ".0" && t != ".00" && t != ".000") throw "bad second format: " + t;
			return n.u === 0 && (t == "s" || t == "ss") ? F(n.S, t.length) : (o = r >= 2 ? r === 3 ? 1e3 : 100 : r === 1 ? 10 : 1, a = Math.round(o * (n.S + n.u)), a >= 60 * o && (a = 0), t === "s" ? a === 0 ? "0" : "" + a / o : (i = F(a, 2 + r), t === "ss" ? i.substr(0, 2) : "." + i.substr(2, t.length - 1)));
		case 90:
			switch (t) {
				case "[h]":
				case "[hh]":
					c = n.D * 24 + n.H;
					break;
				case "[m]":
				case "[mm]":
					c = (n.D * 24 + n.H) * 60 + n.M;
					break;
				case "[s]":
				case "[ss]":
					c = ((n.D * 24 + n.H) * 60 + n.M) * 60 + (r == 0 ? Math.round(n.S + n.u) : n.S);
					break;
				default: throw "bad abstime format: " + t;
			}
			l = t.length === 3 ? 1 : 2;
			break;
		case 101:
			c = s, l = 1;
			break;
	}
	return l > 0 ? F(c, l) : "";
}
function ge(e) {
	var t = 3;
	if (e.length <= t) return e;
	for (var n = e.length % t, r = e.substr(0, n); n != e.length; n += t) r += (r.length > 0 ? "," : "") + e.substr(n, t);
	return r;
}
var _e = /%/g;
function ve(e, t, n) {
	var r = t.replace(_e, ""), i = t.length - r.length;
	return Ie(e, r, n * 10 ** (2 * i)) + _t("%", i);
}
function ye(e, t, n) {
	for (var r = t.length - 1; t.charCodeAt(r - 1) === 44;) --r;
	return Ie(e, t.substr(0, r), n / 10 ** (3 * (t.length - r)));
}
function be(e, t) {
	var n, r = e.indexOf("E") - e.indexOf(".") - 1;
	if (e.match(/^#+0.0E\+0$/)) {
		if (t == 0) return "0.0E+0";
		if (t < 0) return "-" + be(e, -t);
		var i = e.indexOf(".");
		i === -1 && (i = e.indexOf("E"));
		var a = Math.floor(Math.log(t) * Math.LOG10E) % i;
		if (a < 0 && (a += i), n = (t / 10 ** a).toPrecision(r + 1 + (i + a) % i), n.indexOf("e") === -1) {
			var o = Math.floor(Math.log(t) * Math.LOG10E);
			for (n.indexOf(".") === -1 ? n = n.charAt(0) + "." + n.substr(1) + "E+" + (o - n.length + a) : n += "E+" + (o - a); n.substr(0, 2) === "0.";) n = n.charAt(0) + n.substr(2, i) + "." + n.substr(2 + i), n = n.replace(/^0+([1-9])/, "$1").replace(/^0+\./, "0.");
			n = n.replace(/\+-/, "-");
		}
		n = n.replace(/^([+-]?)(\d*)\.(\d*)[Ee]/, function(e, t, n, r) {
			return t + n + r.substr(0, (i + a) % i) + "." + r.substr(a) + "E";
		});
	} else n = t.toExponential(r);
	return e.match(/E\+00$/) && n.match(/e[+-]\d$/) && (n = n.substr(0, n.length - 1) + "0" + n.charAt(n.length - 1)), e.match(/E\-/) && n.match(/e\+/) && (n = n.replace(/e\+/, "e")), n.replace("e", "E");
}
var xe = /# (\?+)( ?)\/( ?)(\d+)/;
function Se(e, t, n) {
	var r = parseInt(e[4], 10), i = Math.round(t * r), a = Math.floor(i / r), o = i - a * r, s = r;
	return n + (a === 0 ? "" : "" + a) + " " + (o === 0 ? _t(" ", e[1].length + 1 + e[4].length) : I(o, e[1].length) + e[2] + "/" + e[3] + F(s, e[4].length));
}
function Ce(e, t, n) {
	return n + (t === 0 ? "" : "" + t) + _t(" ", e[1].length + 2 + e[4].length);
}
var we = /^#*0*\.([0#]+)/, Te = /\)[^)]*[0#]/, Ee = /\(###\) ###\\?-####/;
function De(e) {
	for (var t = "", n, r = 0; r != e.length; ++r) switch (n = e.charCodeAt(r)) {
		case 35: break;
		case 63:
			t += " ";
			break;
		case 48:
			t += "0";
			break;
		default: t += String.fromCharCode(n);
	}
	return t;
}
function Oe(e, t) {
	var n = e < 0 ? -1 : 1, r = 10 ** t;
	return "" + n * (Math.round(n * e * r) / r);
}
function ke(e, t) {
	var n = e - Math.floor(e), r = 10 ** t;
	return t < ("" + Math.round(n * r)).length ? 0 : Math.round(n * r);
}
function G(e, t) {
	return +(t < ("" + Math.round((e - Math.floor(e)) * 10 ** t)).length);
}
function Ae(e) {
	return e < 2147483647 && e > -2147483648 ? "" + (e >= 0 ? e | 0 : e - 1 | 0) : "" + Math.floor(e);
}
function je(e, t, n) {
	if (e.charCodeAt(0) === 40 && !t.match(Te)) {
		var r = t.replace(/\( */, "").replace(/ \)/, "").replace(/\)/, "");
		return n >= 0 ? je("n", r, n) : "(" + je("n", r, -n) + ")";
	}
	if (t.charCodeAt(t.length - 1) === 44) return ye(e, t, n);
	if (t.indexOf("%") !== -1) return ve(e, t, n);
	if (t.indexOf("E") !== -1) return be(t, n);
	if (t.charCodeAt(0) === 36) return "$" + je(e, t.substr(t.charAt(1) == " " ? 2 : 1), n);
	var i, a, o, s, c = Math.abs(n), l = n < 0 ? "-" : "";
	if (t.match(/^00+$/)) return l + R(c, t.length);
	if (t.match(/^[#?]+$/)) return i = R(n, 0), i === "0" && (i = ""), i.length > t.length ? i : De(t.substr(0, t.length - i.length)) + i;
	if (a = t.match(xe)) return Se(a, c, l);
	if (t.match(/^#+0+$/)) return l + R(c, t.length - t.indexOf("0"));
	if (a = t.match(we)) return i = Oe(n, a[1].length).replace(/^([^\.]+)$/, "$1." + De(a[1])).replace(/\.$/, "." + De(a[1])).replace(/\.(\d*)$/, function(e, t) {
		return "." + t + _t("0", De(a[1]).length - t.length);
	}), t.indexOf("0.") === -1 ? i.replace(/^0\./, ".") : i;
	if (t = t.replace(/^#+([0.])/, "$1"), a = t.match(/^(0*)\.(#*)$/)) return l + Oe(c, a[2].length).replace(/\.(\d*[1-9])0*$/, ".$1").replace(/^(-?\d*)$/, "$1.").replace(/^0\./, a[1].length ? "0." : ".");
	if (a = t.match(/^#{1,3},##0(\.?)$/)) return l + ge(R(c, 0));
	if (a = t.match(/^#,##0\.([#0]*0)$/)) return n < 0 ? "-" + je(e, t, -n) : ge("" + (Math.floor(n) + G(n, a[1].length))) + "." + F(ke(n, a[1].length), a[1].length);
	if (a = t.match(/^#,#*,#0/)) return je(e, t.replace(/^#,#*,/, ""), n);
	if (a = t.match(/^([0#]+)(\\?-([0#]+))+$/)) return i = P(je(e, t.replace(/[\\-]/g, ""), n)), o = 0, P(P(t.replace(/\\/g, "")).replace(/[0#]/g, function(e) {
		return o < i.length ? i.charAt(o++) : e === "0" ? "0" : "";
	}));
	if (t.match(Ee)) return i = je(e, "##########", n), "(" + i.substr(0, 3) + ") " + i.substr(3, 3) + "-" + i.substr(6);
	var u = "";
	if (a = t.match(/^([#0?]+)( ?)\/( ?)([#0?]+)/)) return o = Math.min(a[4].length, 7), s = ce(c, 10 ** o - 1, !1), i = "" + l, u = Ie("n", a[1], s[1]), u.charAt(u.length - 1) == " " && (u = u.substr(0, u.length - 1) + "0"), i += u + a[2] + "/" + a[3], u = L(s[2], o), u.length < a[4].length && (u = De(a[4].substr(a[4].length - u.length)) + u), i += u, i;
	if (a = t.match(/^# ([#0?]+)( ?)\/( ?)([#0?]+)/)) return o = Math.min(Math.max(a[1].length, a[4].length), 7), s = ce(c, 10 ** o - 1, !0), l + (s[0] || (s[1] ? "" : "0")) + " " + (s[1] ? I(s[1], o) + a[2] + "/" + a[3] + L(s[2], o) : _t(" ", 2 * o + 1 + a[2].length + a[3].length));
	if (a = t.match(/^[#0?]+$/)) return i = R(n, 0), t.length <= i.length ? i : De(t.substr(0, t.length - i.length)) + i;
	if (a = t.match(/^([#0?]+)\.([#0]+)$/)) {
		i = "" + n.toFixed(Math.min(a[2].length, 10)).replace(/([^0])0+$/, "$1"), o = i.indexOf(".");
		var d = t.indexOf(".") - o, f = t.length - i.length - d;
		return De(t.substr(0, d) + i + t.substr(t.length - f));
	}
	if (a = t.match(/^00,000\.([#0]*0)$/)) return o = ke(n, a[1].length), n < 0 ? "-" + je(e, t, -n) : ge(Ae(n)).replace(/^\d,\d{3}$/, "0$&").replace(/^\d*$/, function(e) {
		return "00," + (e.length < 3 ? F(0, 3 - e.length) : "") + e;
	}) + "." + F(o, a[1].length);
	switch (t) {
		case "###,##0.00": return je(e, "#,##0.00", n);
		case "###,###":
		case "##,###":
		case "#,###":
			var p = ge(R(c, 0));
			return p === "0" ? "" : l + p;
		case "###,###.00": return je(e, "###,##0.00", n).replace(/^0\./, ".");
		case "#,###.00": return je(e, "#,##0.00", n).replace(/^0\./, ".");
		default:
	}
	throw Error("unsupported format |" + t + "|");
}
function Me(e, t, n) {
	for (var r = t.length - 1; t.charCodeAt(r - 1) === 44;) --r;
	return Ie(e, t.substr(0, r), n / 10 ** (3 * (t.length - r)));
}
function Ne(e, t, n) {
	var r = t.replace(_e, ""), i = t.length - r.length;
	return Ie(e, r, n * 10 ** (2 * i)) + _t("%", i);
}
function Pe(e, t) {
	var n, r = e.indexOf("E") - e.indexOf(".") - 1;
	if (e.match(/^#+0.0E\+0$/)) {
		if (t == 0) return "0.0E+0";
		if (t < 0) return "-" + Pe(e, -t);
		var i = e.indexOf(".");
		i === -1 && (i = e.indexOf("E"));
		var a = Math.floor(Math.log(t) * Math.LOG10E) % i;
		if (a < 0 && (a += i), n = (t / 10 ** a).toPrecision(r + 1 + (i + a) % i), !n.match(/[Ee]/)) {
			var o = Math.floor(Math.log(t) * Math.LOG10E);
			n.indexOf(".") === -1 ? n = n.charAt(0) + "." + n.substr(1) + "E+" + (o - n.length + a) : n += "E+" + (o - a), n = n.replace(/\+-/, "-");
		}
		n = n.replace(/^([+-]?)(\d*)\.(\d*)[Ee]/, function(e, t, n, r) {
			return t + n + r.substr(0, (i + a) % i) + "." + r.substr(a) + "E";
		});
	} else n = t.toExponential(r);
	return e.match(/E\+00$/) && n.match(/e[+-]\d$/) && (n = n.substr(0, n.length - 1) + "0" + n.charAt(n.length - 1)), e.match(/E\-/) && n.match(/e\+/) && (n = n.replace(/e\+/, "e")), n.replace("e", "E");
}
function Fe(e, t, n) {
	if (e.charCodeAt(0) === 40 && !t.match(Te)) {
		var r = t.replace(/\( */, "").replace(/ \)/, "").replace(/\)/, "");
		return n >= 0 ? Fe("n", r, n) : "(" + Fe("n", r, -n) + ")";
	}
	if (t.charCodeAt(t.length - 1) === 44) return Me(e, t, n);
	if (t.indexOf("%") !== -1) return Ne(e, t, n);
	if (t.indexOf("E") !== -1) return Pe(t, n);
	if (t.charCodeAt(0) === 36) return "$" + Fe(e, t.substr(t.charAt(1) == " " ? 2 : 1), n);
	var i, a, o, s, c = Math.abs(n), l = n < 0 ? "-" : "";
	if (t.match(/^00+$/)) return l + F(c, t.length);
	if (t.match(/^[#?]+$/)) return i = "" + n, n === 0 && (i = ""), i.length > t.length ? i : De(t.substr(0, t.length - i.length)) + i;
	if (a = t.match(xe)) return Ce(a, c, l);
	if (t.match(/^#+0+$/)) return l + F(c, t.length - t.indexOf("0"));
	if (a = t.match(we)) return i = ("" + n).replace(/^([^\.]+)$/, "$1." + De(a[1])).replace(/\.$/, "." + De(a[1])), i = i.replace(/\.(\d*)$/, function(e, t) {
		return "." + t + _t("0", De(a[1]).length - t.length);
	}), t.indexOf("0.") === -1 ? i.replace(/^0\./, ".") : i;
	if (t = t.replace(/^#+([0.])/, "$1"), a = t.match(/^(0*)\.(#*)$/)) return l + ("" + c).replace(/\.(\d*[1-9])0*$/, ".$1").replace(/^(-?\d*)$/, "$1.").replace(/^0\./, a[1].length ? "0." : ".");
	if (a = t.match(/^#{1,3},##0(\.?)$/)) return l + ge("" + c);
	if (a = t.match(/^#,##0\.([#0]*0)$/)) return n < 0 ? "-" + Fe(e, t, -n) : ge("" + n) + "." + _t("0", a[1].length);
	if (a = t.match(/^#,#*,#0/)) return Fe(e, t.replace(/^#,#*,/, ""), n);
	if (a = t.match(/^([0#]+)(\\?-([0#]+))+$/)) return i = P(Fe(e, t.replace(/[\\-]/g, ""), n)), o = 0, P(P(t.replace(/\\/g, "")).replace(/[0#]/g, function(e) {
		return o < i.length ? i.charAt(o++) : e === "0" ? "0" : "";
	}));
	if (t.match(Ee)) return i = Fe(e, "##########", n), "(" + i.substr(0, 3) + ") " + i.substr(3, 3) + "-" + i.substr(6);
	var u = "";
	if (a = t.match(/^([#0?]+)( ?)\/( ?)([#0?]+)/)) return o = Math.min(a[4].length, 7), s = ce(c, 10 ** o - 1, !1), i = "" + l, u = Ie("n", a[1], s[1]), u.charAt(u.length - 1) == " " && (u = u.substr(0, u.length - 1) + "0"), i += u + a[2] + "/" + a[3], u = L(s[2], o), u.length < a[4].length && (u = De(a[4].substr(a[4].length - u.length)) + u), i += u, i;
	if (a = t.match(/^# ([#0?]+)( ?)\/( ?)([#0?]+)/)) return o = Math.min(Math.max(a[1].length, a[4].length), 7), s = ce(c, 10 ** o - 1, !0), l + (s[0] || (s[1] ? "" : "0")) + " " + (s[1] ? I(s[1], o) + a[2] + "/" + a[3] + L(s[2], o) : _t(" ", 2 * o + 1 + a[2].length + a[3].length));
	if (a = t.match(/^[#0?]+$/)) return i = "" + n, t.length <= i.length ? i : De(t.substr(0, t.length - i.length)) + i;
	if (a = t.match(/^([#0]+)\.([#0]+)$/)) {
		i = "" + n.toFixed(Math.min(a[2].length, 10)).replace(/([^0])0+$/, "$1"), o = i.indexOf(".");
		var d = t.indexOf(".") - o, f = t.length - i.length - d;
		return De(t.substr(0, d) + i + t.substr(t.length - f));
	}
	if (a = t.match(/^00,000\.([#0]*0)$/)) return n < 0 ? "-" + Fe(e, t, -n) : ge("" + n).replace(/^\d,\d{3}$/, "0$&").replace(/^\d*$/, function(e) {
		return "00," + (e.length < 3 ? F(0, 3 - e.length) : "") + e;
	}) + "." + F(0, a[1].length);
	switch (t) {
		case "###,###":
		case "##,###":
		case "#,###":
			var p = ge("" + c);
			return p === "0" ? "" : l + p;
		default: if (t.match(/\.[0#?]*$/)) return Fe(e, t.slice(0, t.lastIndexOf(".")), n) + De(t.slice(t.lastIndexOf(".")));
	}
	throw Error("unsupported format |" + t + "|");
}
function Ie(e, t, n) {
	return (n | 0) === n ? Fe(e, t, n) : je(e, t, n);
}
function Le(e) {
	for (var t = [], n = !1, r = 0, i = 0; r < e.length; ++r) switch (e.charCodeAt(r)) {
		case 34:
			n = !n;
			break;
		case 95:
		case 42:
		case 92:
			++r;
			break;
		case 59: t[t.length] = e.substr(i, r - i), i = r + 1;
	}
	if (t[t.length] = e.substr(i), n === !0) throw Error("Format |" + e + "| unterminated string ");
	return t;
}
var Re = /\[[HhMmSs\u0E0A\u0E19\u0E17]*\]/;
function ze(e) {
	for (var t = 0, n = "", r = ""; t < e.length;) switch (n = e.charAt(t)) {
		case "G":
			z(e, t) && (t += 6), t++;
			break;
		case "\"":
			for (; e.charCodeAt(++t) !== 34 && t < e.length;);
			++t;
			break;
		case "\\":
			t += 2;
			break;
		case "_":
			t += 2;
			break;
		case "@":
			++t;
			break;
		case "B":
		case "b": if (e.charAt(t + 1) === "1" || e.charAt(t + 1) === "2") return !0;
		case "M":
		case "D":
		case "Y":
		case "H":
		case "S":
		case "E":
		case "m":
		case "d":
		case "y":
		case "h":
		case "s":
		case "e":
		case "g": return !0;
		case "A":
		case "a":
		case "上":
			if (e.substr(t, 3).toUpperCase() === "A/P" || e.substr(t, 5).toUpperCase() === "AM/PM" || e.substr(t, 5).toUpperCase() === "上午/下午") return !0;
			++t;
			break;
		case "[":
			for (r = n; e.charAt(t++) !== "]" && t < e.length;) r += e.charAt(t);
			if (r.match(Re)) return !0;
			break;
		case ".":
		case "0":
		case "#":
			for (; t < e.length && ("0#?.,E+-%".indexOf(n = e.charAt(++t)) > -1 || n == "\\" && e.charAt(t + 1) == "-" && "0#".indexOf(e.charAt(t + 2)) > -1););
			break;
		case "?":
			for (; e.charAt(++t) === n;);
			break;
		case "*":
			++t, (e.charAt(t) == " " || e.charAt(t) == "*") && ++t;
			break;
		case "(":
		case ")":
			++t;
			break;
		case "1":
		case "2":
		case "3":
		case "4":
		case "5":
		case "6":
		case "7":
		case "8":
		case "9":
			for (; t < e.length && "0123456789".indexOf(e.charAt(++t)) > -1;);
			break;
		case " ":
			++t;
			break;
		default:
			++t;
			break;
	}
	return !1;
}
function Be(e, t, n, r) {
	for (var i = [], a = "", o = 0, s = "", c = "t", l, u, d, f = "H"; o < e.length;) switch (s = e.charAt(o)) {
		case "G":
			if (!z(e, o)) throw Error("unrecognized character " + s + " in " + e);
			i[i.length] = {
				t: "G",
				v: "General"
			}, o += 7;
			break;
		case "\"":
			for (a = ""; (d = e.charCodeAt(++o)) !== 34 && o < e.length;) a += String.fromCharCode(d);
			i[i.length] = {
				t: "t",
				v: a
			}, ++o;
			break;
		case "\\":
			var p = e.charAt(++o), m = p === "(" || p === ")" ? p : "t";
			i[i.length] = {
				t: m,
				v: p
			}, ++o;
			break;
		case "_":
			i[i.length] = {
				t: "t",
				v: " "
			}, o += 2;
			break;
		case "@":
			i[i.length] = {
				t: "T",
				v: t
			}, ++o;
			break;
		case "B":
		case "b": if (e.charAt(o + 1) === "1" || e.charAt(o + 1) === "2") {
			if (l == null && (l = H(t, n, e.charAt(o + 1) === "2"), l == null)) return "";
			i[i.length] = {
				t: "X",
				v: e.substr(o, 2)
			}, c = s, o += 2;
			break;
		}
		case "M":
		case "D":
		case "Y":
		case "H":
		case "S":
		case "E": s = s.toLowerCase();
		case "m":
		case "d":
		case "y":
		case "h":
		case "s":
		case "e":
		case "g":
			if (t < 0 || l == null && (l = H(t, n), l == null)) return "";
			for (a = s; ++o < e.length && e.charAt(o).toLowerCase() === s;) a += s;
			s === "m" && c.toLowerCase() === "h" && (s = "M"), s === "h" && (s = f), i[i.length] = {
				t: s,
				v: a
			}, c = s;
			break;
		case "A":
		case "a":
		case "上":
			var h = {
				t: s,
				v: s
			};
			if (l == null && (l = H(t, n)), e.substr(o, 3).toUpperCase() === "A/P" ? (l != null && (h.v = l.H >= 12 ? e.charAt(o + 2) : s), h.t = "T", f = "h", o += 3) : e.substr(o, 5).toUpperCase() === "AM/PM" ? (l != null && (h.v = l.H >= 12 ? "PM" : "AM"), h.t = "T", o += 5, f = "h") : e.substr(o, 5).toUpperCase() === "上午/下午" ? (l != null && (h.v = l.H >= 12 ? "下午" : "上午"), h.t = "T", o += 5, f = "h") : (h.t = "t", ++o), l == null && h.t === "T") return "";
			i[i.length] = h, c = s;
			break;
		case "[":
			for (a = s; e.charAt(o++) !== "]" && o < e.length;) a += e.charAt(o);
			if (a.slice(-1) !== "]") throw "unterminated \"[\" block: |" + a + "|";
			if (a.match(Re)) {
				if (l == null && (l = H(t, n), l == null)) return "";
				i[i.length] = {
					t: "Z",
					v: a.toLowerCase()
				}, c = a.charAt(1);
			} else a.indexOf("$") > -1 && (a = (a.match(/\$([^-\[\]]*)/) || [])[1] || "$", ze(e) || (i[i.length] = {
				t: "t",
				v: a
			}));
			break;
		case ".": if (l != null) {
			for (a = s; ++o < e.length && (s = e.charAt(o)) === "0";) a += s;
			i[i.length] = {
				t: "s",
				v: a
			};
			break;
		}
		case "0":
		case "#":
			for (a = s; ++o < e.length && "0#?.,E+-%".indexOf(s = e.charAt(o)) > -1;) a += s;
			i[i.length] = {
				t: "n",
				v: a
			};
			break;
		case "?":
			for (a = s; e.charAt(++o) === s;) a += s;
			i[i.length] = {
				t: s,
				v: a
			}, c = s;
			break;
		case "*":
			++o, (e.charAt(o) == " " || e.charAt(o) == "*") && ++o;
			break;
		case "(":
		case ")":
			i[i.length] = {
				t: r === 1 ? "t" : s,
				v: s
			}, ++o;
			break;
		case "1":
		case "2":
		case "3":
		case "4":
		case "5":
		case "6":
		case "7":
		case "8":
		case "9":
			for (a = s; o < e.length && "0123456789".indexOf(e.charAt(++o)) > -1;) a += e.charAt(o);
			i[i.length] = {
				t: "D",
				v: a
			};
			break;
		case " ":
			i[i.length] = {
				t: s,
				v: s
			}, ++o;
			break;
		case "$":
			i[i.length] = {
				t: "t",
				v: "$"
			}, ++o;
			break;
		default:
			if (",$-+/():!^&'~{}<>=€acfijklopqrtuvwxzP".indexOf(s) === -1) throw Error("unrecognized character " + s + " in " + e);
			i[i.length] = {
				t: "t",
				v: s
			}, ++o;
			break;
	}
	var g = 0, _ = 0, v;
	for (o = i.length - 1, c = "t"; o >= 0; --o) switch (i[o].t) {
		case "h":
		case "H":
			i[o].t = f, c = "h", g < 1 && (g = 1);
			break;
		case "s": (v = i[o].v.match(/\.0+$/)) && (_ = Math.max(_, v[0].length - 1), g = 4), g < 3 && (g = 3);
		case "d":
		case "y":
		case "e":
			c = i[o].t;
			break;
		case "M":
			c = i[o].t, g < 2 && (g = 2);
			break;
		case "m":
			c === "s" && (i[o].t = "M", g < 2 && (g = 2));
			break;
		case "X": break;
		case "Z": g < 1 && i[o].v.match(/[Hh]/) && (g = 1), g < 2 && i[o].v.match(/[Mm]/) && (g = 2), g < 3 && i[o].v.match(/[Ss]/) && (g = 3);
	}
	var y;
	switch (g) {
		case 0: break;
		case 1:
		case 2:
		case 3:
			l.u >= .5 && (l.u = 0, ++l.S), l.S >= 60 && (l.S = 0, ++l.M), l.M >= 60 && (l.M = 0, ++l.H), l.H >= 24 && (l.H = 0, ++l.D, y = H(l.D), y.u = l.u, y.S = l.S, y.M = l.M, y.H = l.H, l = y);
			break;
		case 4:
			switch (_) {
				case 1:
					l.u = Math.round(l.u * 10) / 10;
					break;
				case 2:
					l.u = Math.round(l.u * 100) / 100;
					break;
				case 3:
					l.u = Math.round(l.u * 1e3) / 1e3;
					break;
			}
			l.u >= 1 && (l.u = 0, ++l.S), l.S >= 60 && (l.S = 0, ++l.M), l.M >= 60 && (l.M = 0, ++l.H), l.H >= 24 && (l.H = 0, ++l.D, y = H(l.D), y.u = l.u, y.S = l.S, y.M = l.M, y.H = l.H, l = y);
			break;
	}
	var b = "", x;
	for (o = 0; o < i.length; ++o) switch (i[o].t) {
		case "t":
		case "T":
		case " ":
		case "D": break;
		case "X":
			i[o].v = "", i[o].t = ";";
			break;
		case "d":
		case "m":
		case "y":
		case "h":
		case "H":
		case "M":
		case "s":
		case "e":
		case "b":
		case "Z":
			i[o].v = he(i[o].t.charCodeAt(0), i[o].v, l, _), i[o].t = "t";
			break;
		case "n":
		case "?":
			for (x = o + 1; i[x] != null && ((s = i[x].t) === "?" || s === "D" || (s === " " || s === "t") && i[x + 1] != null && (i[x + 1].t === "?" || i[x + 1].t === "t" && i[x + 1].v === "/") || i[o].t === "(" && (s === " " || s === "n" || s === ")") || s === "t" && (i[x].v === "/" || i[x].v === " " && i[x + 1] != null && i[x + 1].t == "?"));) i[o].v += i[x].v, i[x] = {
				v: "",
				t: ";"
			}, ++x;
			b += i[o].v, o = x - 1;
			break;
		case "G":
			i[o].t = "t", i[o].v = pe(t, n);
			break;
	}
	var S = "", C, w;
	if (b.length > 0) {
		b.charCodeAt(0) == 40 ? (C = t < 0 && b.charCodeAt(0) === 45 ? -t : t, w = Ie("n", b, C)) : (C = t < 0 && r > 1 ? -t : t, w = Ie("n", b, C), C < 0 && i[0] && i[0].t == "t" && (w = w.substr(1), i[0].v = "-" + i[0].v)), x = w.length - 1;
		var T = i.length;
		for (o = 0; o < i.length; ++o) if (i[o] != null && i[o].t != "t" && i[o].v.indexOf(".") > -1) {
			T = o;
			break;
		}
		var E = i.length;
		if (T === i.length && w.indexOf("E") === -1) {
			for (o = i.length - 1; o >= 0; --o) i[o] == null || "n?".indexOf(i[o].t) === -1 || (x >= i[o].v.length - 1 ? (x -= i[o].v.length, i[o].v = w.substr(x + 1, i[o].v.length)) : x < 0 ? i[o].v = "" : (i[o].v = w.substr(0, x + 1), x = -1), i[o].t = "t", E = o);
			x >= 0 && E < i.length && (i[E].v = w.substr(0, x + 1) + i[E].v);
		} else if (T !== i.length && w.indexOf("E") === -1) {
			for (x = w.indexOf(".") - 1, o = T; o >= 0; --o) if (!(i[o] == null || "n?".indexOf(i[o].t) === -1)) {
				for (u = i[o].v.indexOf(".") > -1 && o === T ? i[o].v.indexOf(".") - 1 : i[o].v.length - 1, S = i[o].v.substr(u + 1); u >= 0; --u) x >= 0 && (i[o].v.charAt(u) === "0" || i[o].v.charAt(u) === "#") && (S = w.charAt(x--) + S);
				i[o].v = S, i[o].t = "t", E = o;
			}
			for (x >= 0 && E < i.length && (i[E].v = w.substr(0, x + 1) + i[E].v), x = w.indexOf(".") + 1, o = T; o < i.length; ++o) if (!(i[o] == null || "n?(".indexOf(i[o].t) === -1 && o !== T)) {
				for (u = i[o].v.indexOf(".") > -1 && o === T ? i[o].v.indexOf(".") + 1 : 0, S = i[o].v.substr(0, u); u < i[o].v.length; ++u) x < w.length && (S += w.charAt(x++));
				i[o].v = S, i[o].t = "t", E = o;
			}
		}
	}
	for (o = 0; o < i.length; ++o) i[o] != null && "n?".indexOf(i[o].t) > -1 && (C = r > 1 && t < 0 && o > 0 && i[o - 1].v === "-" ? -t : t, i[o].v = Ie(i[o].t, i[o].v, C), i[o].t = "t");
	var D = "";
	for (o = 0; o !== i.length; ++o) i[o] != null && (D += i[o].v);
	return D;
}
var Ve = /\[(=|>[=]?|<[>=]?)(-?\d+(?:\.\d*)?)\]/;
function He(e, t) {
	if (t == null) return !1;
	var n = parseFloat(t[2]);
	switch (t[1]) {
		case "=":
			if (e == n) return !0;
			break;
		case ">":
			if (e > n) return !0;
			break;
		case "<":
			if (e < n) return !0;
			break;
		case "<>":
			if (e != n) return !0;
			break;
		case ">=":
			if (e >= n) return !0;
			break;
		case "<=":
			if (e <= n) return !0;
			break;
	}
	return !1;
}
function Ue(e, t) {
	var n = Le(e), r = n.length, i = n[r - 1].indexOf("@");
	if (r < 4 && i > -1 && --r, n.length > 4) throw Error("cannot find right format for |" + n.join("|") + "|");
	if (typeof t != "number") return [4, n.length === 4 || i > -1 ? n[n.length - 1] : "@"];
	switch (typeof t == "number" && !isFinite(t) && (t = 0), n.length) {
		case 1:
			n = i > -1 ? [
				"General",
				"General",
				"General",
				n[0]
			] : [
				n[0],
				n[0],
				n[0],
				"@"
			];
			break;
		case 2:
			n = i > -1 ? [
				n[0],
				n[0],
				n[0],
				n[1]
			] : [
				n[0],
				n[1],
				n[0],
				"@"
			];
			break;
		case 3:
			n = i > -1 ? [
				n[0],
				n[1],
				n[0],
				n[2]
			] : [
				n[0],
				n[1],
				n[2],
				"@"
			];
			break;
		case 4: break;
	}
	var a = t > 0 ? n[0] : t < 0 ? n[1] : n[2];
	if (n[0].indexOf("[") === -1 && n[1].indexOf("[") === -1) return [r, a];
	if (n[0].match(/\[[=<>]/) != null || n[1].match(/\[[=<>]/) != null) {
		var o = n[0].match(Ve), s = n[1].match(Ve);
		return He(t, o) ? [r, n[0]] : He(t, s) ? [r, n[1]] : [r, n[o != null && s != null ? 2 : 1]];
	}
	return [r, a];
}
function We(e, t, n) {
	n == null && (n = {});
	var r = "";
	switch (typeof e) {
		case "string":
			r = e == "m/d/yy" && n.dateNF ? n.dateNF : e;
			break;
		case "number":
			r = e == 14 && n.dateNF ? n.dateNF : (n.table == null ? V : n.table)[e], r == null && (r = n.table && n.table[oe[e]] || V[oe[e]]), r == null && (r = se[e] || "General");
			break;
	}
	if (z(r, 0)) return pe(t, n);
	t instanceof Date && (t = ct(t, n.date1904));
	var i = Ue(r, t);
	if (z(i[1])) return pe(t, n);
	if (t === !0) t = "TRUE";
	else if (t === !1) t = "FALSE";
	else if (t === "" || t == null) return "";
	else if (isNaN(t) && i[1].indexOf("0") > -1) return "#NUM!";
	else if (!isFinite(t) && i[1].indexOf("0") > -1) return "#DIV/0!";
	return Be(i[1], t, n, i[0]);
}
function Ge(e, t) {
	if (typeof t != "number") {
		t = +t || -1;
		for (var n = 0; n < 392; ++n) {
			if (V[n] == null) {
				t < 0 && (t = n);
				continue;
			}
			if (V[n] == e) {
				t = n;
				break;
			}
		}
		t < 0 && (t = 391);
	}
	return V[t] = e, t;
}
function Ke() {
	V = ae();
}
var qe = {
	5: "\"$\"#,##0_);\\(\"$\"#,##0\\)",
	6: "\"$\"#,##0_);[Red]\\(\"$\"#,##0\\)",
	7: "\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)",
	8: "\"$\"#,##0.00_);[Red]\\(\"$\"#,##0.00\\)",
	23: "General",
	24: "General",
	25: "General",
	26: "General",
	27: "m/d/yy",
	28: "m/d/yy",
	29: "m/d/yy",
	30: "m/d/yy",
	31: "m/d/yy",
	32: "h:mm:ss",
	33: "h:mm:ss",
	34: "h:mm:ss",
	35: "h:mm:ss",
	36: "m/d/yy",
	41: "_(* #,##0_);_(* (#,##0);_(* \"-\"_);_(@_)",
	42: "_(\"$\"* #,##0_);_(\"$\"* (#,##0);_(\"$\"* \"-\"_);_(@_)",
	43: "_(* #,##0.00_);_(* (#,##0.00);_(* \"-\"??_);_(@_)",
	44: "_(\"$\"* #,##0.00_);_(\"$\"* (#,##0.00);_(\"$\"* \"-\"??_);_(@_)",
	50: "m/d/yy",
	51: "m/d/yy",
	52: "m/d/yy",
	53: "m/d/yy",
	54: "m/d/yy",
	55: "m/d/yy",
	56: "m/d/yy",
	57: "m/d/yy",
	58: "m/d/yy",
	59: "0",
	60: "0.00",
	61: "#,##0",
	62: "#,##0.00",
	63: "\"$\"#,##0_);\\(\"$\"#,##0\\)",
	64: "\"$\"#,##0_);[Red]\\(\"$\"#,##0\\)",
	65: "\"$\"#,##0.00_);\\(\"$\"#,##0.00\\)",
	66: "\"$\"#,##0.00_);[Red]\\(\"$\"#,##0.00\\)",
	67: "0%",
	68: "0.00%",
	69: "# ?/?",
	70: "# ??/??",
	71: "m/d/yy",
	72: "m/d/yy",
	73: "d-mmm-yy",
	74: "d-mmm",
	75: "mmm-yy",
	76: "h:mm",
	77: "h:mm:ss",
	78: "m/d/yy h:mm",
	79: "mm:ss",
	80: "[h]:mm:ss",
	81: "mmss.0"
}, Je = /[dD]+|[mM]+|[yYeE]+|[Hh]+|[Ss]+/g;
function Ye(e) {
	var t = typeof e == "number" ? V[e] : e;
	return t = t.replace(Je, "(\\d+)"), Je.lastIndex = 0, RegExp("^" + t + "$");
}
function Xe(e, t, n) {
	var r = -1, i = -1, a = -1, o = -1, s = -1, c = -1;
	(t.match(Je) || []).forEach(function(e, t) {
		var l = parseInt(n[t + 1], 10);
		switch (e.toLowerCase().charAt(0)) {
			case "y":
				r = l;
				break;
			case "d":
				a = l;
				break;
			case "h":
				o = l;
				break;
			case "s":
				c = l;
				break;
			case "m":
				o >= 0 ? s = l : i = l;
				break;
		}
	}), Je.lastIndex = 0, c >= 0 && s == -1 && i >= 0 && (s = i, i = -1);
	var l = ("" + (r >= 0 ? r : (/* @__PURE__ */ new Date()).getFullYear())).slice(-4) + "-" + ("00" + (i >= 1 ? i : 1)).slice(-2) + "-" + ("00" + (a >= 1 ? a : 1)).slice(-2);
	l.length == 7 && (l = "0" + l), l.length == 8 && (l = "20" + l);
	var u = ("00" + (o >= 0 ? o : 0)).slice(-2) + ":" + ("00" + (s >= 0 ? s : 0)).slice(-2) + ":" + ("00" + (c >= 0 ? c : 0)).slice(-2);
	return o == -1 && s == -1 && c == -1 ? l : r == -1 && i == -1 && a == -1 ? u : l + "T" + u;
}
var Ze = { "d.m": "d\\.m" };
function Qe(e, t) {
	return Ge(Ze[e] || e, t);
}
var $e = /*#__PURE__*/ (function() {
	var e = {};
	e.version = "1.2.0";
	function t() {
		for (var e = 0, t = Array(256), n = 0; n != 256; ++n) e = n, e = e & 1 ? -306674912 ^ e >>> 1 : e >>> 1, e = e & 1 ? -306674912 ^ e >>> 1 : e >>> 1, e = e & 1 ? -306674912 ^ e >>> 1 : e >>> 1, e = e & 1 ? -306674912 ^ e >>> 1 : e >>> 1, e = e & 1 ? -306674912 ^ e >>> 1 : e >>> 1, e = e & 1 ? -306674912 ^ e >>> 1 : e >>> 1, e = e & 1 ? -306674912 ^ e >>> 1 : e >>> 1, e = e & 1 ? -306674912 ^ e >>> 1 : e >>> 1, t[n] = e;
		return typeof Int32Array < "u" ? new Int32Array(t) : t;
	}
	var n = t();
	function r(e) {
		var t = 0, n = 0, r = 0, i = typeof Int32Array < "u" ? new Int32Array(4096) : Array(4096);
		for (r = 0; r != 256; ++r) i[r] = e[r];
		for (r = 0; r != 256; ++r) for (n = e[r], t = 256 + r; t < 4096; t += 256) n = i[t] = n >>> 8 ^ e[n & 255];
		var a = [];
		for (r = 1; r != 16; ++r) a[r - 1] = typeof Int32Array < "u" && typeof i.subarray == "function" ? i.subarray(r * 256, r * 256 + 256) : i.slice(r * 256, r * 256 + 256);
		return a;
	}
	var i = r(n), a = i[0], o = i[1], s = i[2], c = i[3], l = i[4], u = i[5], d = i[6], f = i[7], p = i[8], m = i[9], h = i[10], g = i[11], _ = i[12], v = i[13], y = i[14];
	function b(e, t) {
		for (var r = t ^ -1, i = 0, a = e.length; i < a;) r = r >>> 8 ^ n[(r ^ e.charCodeAt(i++)) & 255];
		return ~r;
	}
	function x(e, t) {
		for (var r = t ^ -1, i = e.length - 15, b = 0; b < i;) r = y[e[b++] ^ r & 255] ^ v[e[b++] ^ r >> 8 & 255] ^ _[e[b++] ^ r >> 16 & 255] ^ g[e[b++] ^ r >>> 24] ^ h[e[b++]] ^ m[e[b++]] ^ p[e[b++]] ^ f[e[b++]] ^ d[e[b++]] ^ u[e[b++]] ^ l[e[b++]] ^ c[e[b++]] ^ s[e[b++]] ^ o[e[b++]] ^ a[e[b++]] ^ n[e[b++]];
		for (i += 15; b < i;) r = r >>> 8 ^ n[(r ^ e[b++]) & 255];
		return ~r;
	}
	function S(e, t) {
		for (var r = t ^ -1, i = 0, a = e.length, o = 0, s = 0; i < a;) o = e.charCodeAt(i++), o < 128 ? r = r >>> 8 ^ n[(r ^ o) & 255] : o < 2048 ? (r = r >>> 8 ^ n[(r ^ (192 | o >> 6 & 31)) & 255], r = r >>> 8 ^ n[(r ^ (128 | o & 63)) & 255]) : o >= 55296 && o < 57344 ? (o = (o & 1023) + 64, s = e.charCodeAt(i++) & 1023, r = r >>> 8 ^ n[(r ^ (240 | o >> 8 & 7)) & 255], r = r >>> 8 ^ n[(r ^ (128 | o >> 2 & 63)) & 255], r = r >>> 8 ^ n[(r ^ (128 | s >> 6 & 15 | (o & 3) << 4)) & 255], r = r >>> 8 ^ n[(r ^ (128 | s & 63)) & 255]) : (r = r >>> 8 ^ n[(r ^ (224 | o >> 12 & 15)) & 255], r = r >>> 8 ^ n[(r ^ (128 | o >> 6 & 63)) & 255], r = r >>> 8 ^ n[(r ^ (128 | o & 63)) & 255]);
		return ~r;
	}
	return e.table = n, e.bstr = b, e.buf = x, e.str = S, e;
})(), et = /*#__PURE__*/ (function() {
	var e = {};
	e.version = "1.2.2";
	function t(e, t) {
		for (var n = e.split("/"), r = t.split("/"), i = 0, a = 0, o = Math.min(n.length, r.length); i < o; ++i) {
			if (a = n[i].length - r[i].length) return a;
			if (n[i] != r[i]) return n[i] < r[i] ? -1 : 1;
		}
		return n.length - r.length;
	}
	function n(e) {
		if (e.charAt(e.length - 1) == "/") return e.slice(0, -1).indexOf("/") === -1 ? e : n(e.slice(0, -1));
		var t = e.lastIndexOf("/");
		return t === -1 ? e : e.slice(0, t + 1);
	}
	function r(e) {
		if (e.charAt(e.length - 1) == "/") return r(e.slice(0, -1));
		var t = e.lastIndexOf("/");
		return t === -1 ? e : e.slice(t + 1);
	}
	function i(e, t) {
		typeof t == "string" && (t = new Date(t));
		var n = t.getHours();
		n = n << 6 | t.getMinutes(), n = n << 5 | t.getSeconds() >>> 1, e.write_shift(2, n);
		var r = t.getFullYear() - 1980;
		r = r << 4 | t.getMonth() + 1, r = r << 5 | t.getDate(), e.write_shift(2, r);
	}
	function a(e) {
		var t = e.read_shift(2) & 65535, n = e.read_shift(2) & 65535, r = /* @__PURE__ */ new Date(), i = n & 31;
		n >>>= 5;
		var a = n & 15;
		n >>>= 4, r.setMilliseconds(0), r.setFullYear(n + 1980), r.setMonth(a - 1), r.setDate(i);
		var o = t & 31;
		t >>>= 5;
		var s = t & 63;
		return t >>>= 6, r.setHours(t), r.setMinutes(s), r.setSeconds(o << 1), r;
	}
	function o(e) {
		pr(e, 0);
		for (var t = {}, n = 0; e.l <= e.length - 4;) {
			var r = e.read_shift(2), i = e.read_shift(2), a = e.l + i, o = {};
			switch (r) {
				case 21589:
					n = e.read_shift(1), n & 1 && (o.mtime = e.read_shift(4)), i > 5 && (n & 2 && (o.atime = e.read_shift(4)), n & 4 && (o.ctime = e.read_shift(4))), o.mtime && (o.mt = /* @__PURE__ */ new Date(o.mtime * 1e3));
					break;
				case 1:
					var s = e.read_shift(4), c = e.read_shift(4);
					o.usz = c * 2 ** 32 + s, s = e.read_shift(4), c = e.read_shift(4), o.csz = c * 2 ** 32 + s;
					break;
			}
			e.l = a, t[r] = o;
		}
		return t;
	}
	var s;
	function c() {
		return s || (s = tt);
	}
	function l(e, t) {
		if (e[0] == 80 && e[1] == 75) return ze(e, t);
		if ((e[0] | 32) == 109 && (e[1] | 32) == 105) return Je(e, t);
		if (e.length < 512) throw Error("CFB file size " + e.length + " < 512");
		var n = 3, r = 512, i = 0, a = 0, o = 0, s = 0, c = 0, l = [], m = e.slice(0, 512);
		pr(m, 0);
		var g = u(m);
		switch (n = g[0], n) {
			case 3:
				r = 512;
				break;
			case 4:
				r = 4096;
				break;
			case 0: if (g[1] == 0) return ze(e, t);
			default: throw Error("Major Version: Expected 3 or 4 saw " + n);
		}
		r !== 512 && (m = e.slice(0, r), pr(m, 28));
		var y = e.slice(0, r);
		d(m, n);
		var b = m.read_shift(4, "i");
		if (n === 3 && b !== 0) throw Error("# Directory Sectors: Expected 0 saw " + b);
		m.l += 4, o = m.read_shift(4, "i"), m.l += 4, m.chk("00100000", "Mini Stream Cutoff Size: "), s = m.read_shift(4, "i"), i = m.read_shift(4, "i"), c = m.read_shift(4, "i"), a = m.read_shift(4, "i");
		for (var x = -1, S = 0; S < 109 && (x = m.read_shift(4, "i"), !(x < 0)); ++S) l[S] = x;
		var C = f(e, r);
		h(c, a, C, r, l);
		var w = _(C, o, l, r);
		o < w.length && (w[o].name = "!Directory"), i > 0 && s !== L && (w[s].name = "!MiniFAT"), w[l[0]].name = "!FAT", w.fat_addrs = l, w.ssz = r;
		var T = {}, E = [], D = [], O = [];
		v(o, w, C, E, i, T, D, s), p(D, O, E), E.shift();
		var k = {
			FileIndex: D,
			FullPaths: O
		};
		return t && t.raw && (k.raw = {
			header: y,
			sectors: C
		}), k;
	}
	function u(e) {
		if (e[e.l] == 80 && e[e.l + 1] == 75) return [0, 0];
		e.chk(te, "Header Signature: "), e.l += 16;
		var t = e.read_shift(2, "u");
		return [e.read_shift(2, "u"), t];
	}
	function d(e, t) {
		var n = 9;
		switch (e.l += 2, n = e.read_shift(2)) {
			case 9:
				if (t != 3) throw Error("Sector Shift: Expected 9 saw " + n);
				break;
			case 12:
				if (t != 4) throw Error("Sector Shift: Expected 12 saw " + n);
				break;
			default: throw Error("Sector Shift: Expected 9 or 12 saw " + n);
		}
		e.chk("0600", "Mini Sector Shift: "), e.chk("000000000000", "Reserved: ");
	}
	function f(e, t) {
		for (var n = Math.ceil(e.length / t) - 1, r = [], i = 1; i < n; ++i) r[i - 1] = e.slice(i * t, (i + 1) * t);
		return r[n - 1] = e.slice(n * t), r;
	}
	function p(e, t, n) {
		for (var r = 0, i = 0, a = 0, o = 0, s = 0, c = n.length, l = [], u = []; r < c; ++r) l[r] = u[r] = r, t[r] = n[r];
		for (; s < u.length; ++s) r = u[s], i = e[r].L, a = e[r].R, o = e[r].C, l[r] === r && (i !== -1 && l[i] !== i && (l[r] = l[i]), a !== -1 && l[a] !== a && (l[r] = l[a])), o !== -1 && (l[o] = r), i !== -1 && r != l[r] && (l[i] = l[r], u.lastIndexOf(i) < s && u.push(i)), a !== -1 && r != l[r] && (l[a] = l[r], u.lastIndexOf(a) < s && u.push(a));
		for (r = 1; r < c; ++r) l[r] === r && (a !== -1 && l[a] !== a ? l[r] = l[a] : i !== -1 && l[i] !== i && (l[r] = l[i]));
		for (r = 1; r < c; ++r) if (e[r].type !== 0) {
			if (s = r, s != l[s]) do
				s = l[s], t[r] = t[s] + "/" + t[r];
			while (s !== 0 && l[s] !== -1 && s != l[s]);
			l[r] = -1;
		}
		for (t[0] += "/", r = 1; r < c; ++r) e[r].type !== 2 && (t[r] += "/");
	}
	function m(e, t, n) {
		for (var r = e.start, i = e.size, a = [], o = r; n && i > 0 && o >= 0;) a.push(t.slice(o * I, o * I + I)), i -= I, o = ar(n, o * 4);
		return a.length === 0 ? hr(0) : j(a).slice(0, e.size);
	}
	function h(e, t, n, r, i) {
		var a = L;
		if (e === L) {
			if (t !== 0) throw Error("DIFAT chain shorter than expected");
		} else if (e !== -1) {
			var o = n[e], s = (r >>> 2) - 1;
			if (!o) return;
			for (var c = 0; c < s && (a = ar(o, c * 4)) !== L; ++c) i.push(a);
			t >= 1 && h(ar(o, r - 4), t - 1, n, r, i);
		}
	}
	function g(e, t, n, r, i) {
		var a = [], o = [];
		i || (i = []);
		var s = r - 1, c = 0, l = 0;
		for (c = t; c >= 0;) {
			i[c] = !0, a[a.length] = c, o.push(e[c]);
			var u = n[Math.floor(c * 4 / r)];
			if (l = c * 4 & s, r < 4 + l) throw Error("FAT boundary crossed: " + c + " 4 " + r);
			if (!e[u]) break;
			c = ar(e[u], l);
		}
		return {
			nodes: a,
			data: Pn([o])
		};
	}
	function _(e, t, n, r) {
		var i = e.length, a = [], o = [], s = [], c = [], l = r - 1, u = 0, d = 0, f = 0, p = 0;
		for (u = 0; u < i; ++u) if (s = [], f = u + t, f >= i && (f -= i), !o[f]) {
			c = [];
			var m = [];
			for (d = f; d >= 0;) {
				m[d] = !0, o[d] = !0, s[s.length] = d, c.push(e[d]);
				var h = n[Math.floor(d * 4 / r)];
				if (p = d * 4 & l, r < 4 + p) throw Error("FAT boundary crossed: " + d + " 4 " + r);
				if (!e[h] || (d = ar(e[h], p), m[d])) break;
			}
			a[f] = {
				nodes: s,
				data: Pn([c])
			};
		}
		return a;
	}
	function v(e, t, n, r, i, a, o, s) {
		for (var c = 0, l = r.length ? 2 : 0, u = t[e].data, d = 0, f = 0, p; d < u.length; d += 128) {
			var h = u.slice(d, d + 128);
			pr(h, 64), f = h.read_shift(2), p = In(h, 0, f - l), r.push(p);
			var _ = {
				name: p,
				type: h.read_shift(1),
				color: h.read_shift(1),
				L: h.read_shift(4, "i"),
				R: h.read_shift(4, "i"),
				C: h.read_shift(4, "i"),
				clsid: h.read_shift(16),
				state: h.read_shift(4, "i"),
				start: 0,
				size: 0
			};
			h.read_shift(2) + h.read_shift(2) + h.read_shift(2) + h.read_shift(2) !== 0 && (_.ct = y(h, h.l - 8)), h.read_shift(2) + h.read_shift(2) + h.read_shift(2) + h.read_shift(2) !== 0 && (_.mt = y(h, h.l - 8)), _.start = h.read_shift(4, "i"), _.size = h.read_shift(4, "i"), _.size < 0 && _.start < 0 && (_.size = _.type = 0, _.start = L, _.name = ""), _.type === 5 ? (c = _.start, i > 0 && c !== L && (t[c].name = "!StreamData")) : _.size >= 4096 ? (_.storage = "fat", t[_.start] === void 0 && (t[_.start] = g(n, _.start, t.fat_addrs, t.ssz)), t[_.start].name = _.name, _.content = t[_.start].data.slice(0, _.size)) : (_.storage = "minifat", _.size < 0 ? _.size = 0 : c !== L && _.start !== L && t[c] && (_.content = m(_, t[c].data, (t[s] || {}).data))), _.content && pr(_.content, 0), a[p] = _, o.push(_);
		}
	}
	function y(e, t) {
		return /* @__PURE__ */ new Date((ir(e, t + 4) / 1e7 * 2 ** 32 + ir(e, t) / 1e7 - 11644473600) * 1e3);
	}
	function x(e, t) {
		return c(), l(s.readFileSync(e), t);
	}
	function T(e, t) {
		var n = t && t.type;
		switch (n || C && Buffer.isBuffer(e) && (n = "buffer"), n || "base64") {
			case "file": return x(e, t);
			case "base64": return l(O(S(e)), t);
			case "binary": return l(O(e), t);
		}
		return l(e, t);
	}
	function k(e, t) {
		var n = t || {}, r = n.root || "Root Entry";
		if (e.FullPaths || (e.FullPaths = []), e.FileIndex || (e.FileIndex = []), e.FullPaths.length !== e.FileIndex.length) throw Error("inconsistent CFB structure");
		e.FullPaths.length === 0 && (e.FullPaths[0] = r + "/", e.FileIndex[0] = {
			name: r,
			type: 5
		}), n.CLSID && (e.FileIndex[0].clsid = n.CLSID), A(e);
	}
	function A(e) {
		var t = "Sh33tJ5";
		if (!et.find(e, "/" + t)) {
			var n = hr(4);
			n[0] = 55, n[1] = n[3] = 50, n[2] = 54, e.FileIndex.push({
				name: t,
				type: 2,
				content: n,
				size: 4,
				L: 69,
				R: 69,
				C: 69
			}), e.FullPaths.push(e.FullPaths[0] + t), ee(e);
		}
	}
	function ee(e, i) {
		k(e);
		for (var a = !1, o = !1, s = e.FullPaths.length - 1; s >= 0; --s) {
			var c = e.FileIndex[s];
			switch (c.type) {
				case 0:
					o ? a = !0 : (e.FileIndex.pop(), e.FullPaths.pop());
					break;
				case 1:
				case 2:
				case 5:
					o = !0, isNaN(c.R * c.L * c.C) && (a = !0), c.R > -1 && c.L > -1 && c.R == c.L && (a = !0);
					break;
				default:
					a = !0;
					break;
			}
		}
		if (!(!a && !i)) {
			var l = new Date(1987, 1, 19), u = 0, d = Object.create ? Object.create(null) : {}, f = [];
			for (s = 0; s < e.FullPaths.length; ++s) d[e.FullPaths[s]] = !0, e.FileIndex[s].type !== 0 && f.push([e.FullPaths[s], e.FileIndex[s]]);
			for (s = 0; s < f.length; ++s) {
				var p = n(f[s][0]);
				for (o = d[p]; !o;) {
					for (; n(p) && !d[n(p)];) p = n(p);
					f.push([p, {
						name: r(p).replace("/", ""),
						type: 1,
						clsid: re,
						ct: l,
						mt: l,
						content: null
					}]), d[p] = !0, p = n(f[s][0]), o = d[p];
				}
			}
			for (f.sort(function(e, n) {
				return t(e[0], n[0]);
			}), e.FullPaths = [], e.FileIndex = [], s = 0; s < f.length; ++s) e.FullPaths[s] = f[s][0], e.FileIndex[s] = f[s][1];
			for (s = 0; s < f.length; ++s) {
				var m = e.FileIndex[s], h = e.FullPaths[s];
				if (m.name = r(h).replace("/", ""), m.L = m.R = m.C = -(m.color = 1), m.size = m.content ? m.content.length : 0, m.start = 0, m.clsid = m.clsid || re, s === 0) m.C = f.length > 1 ? 1 : -1, m.size = 0, m.type = 5;
				else if (h.slice(-1) == "/") {
					for (u = s + 1; u < f.length && n(e.FullPaths[u]) != h; ++u);
					for (m.C = u >= f.length ? -1 : u, u = s + 1; u < f.length && n(e.FullPaths[u]) != n(h); ++u);
					m.R = u >= f.length ? -1 : u, m.type = 1;
				} else n(e.FullPaths[s + 1] || "") == n(h) && (m.R = s + 1), m.type = 2;
			}
		}
	}
	function P(e, t) {
		var n = t || {};
		if (n.fileType == "mad") return Ye(e, n);
		switch (ee(e), n.fileType) {
			case "zip": return Ve(e, n);
		}
		var r = (function(e) {
			for (var t = 0, n = 0, r = 0; r < e.FileIndex.length; ++r) {
				var i = e.FileIndex[r];
				if (i.content) {
					var a = i.content.length;
					a > 0 && (a < 4096 ? t += a + 63 >> 6 : n += a + 511 >> 9);
				}
			}
			for (var o = e.FullPaths.length + 3 >> 2, s = t + 7 >> 3, c = t + 127 >> 7, l = s + n + o + c, u = l + 127 >> 7, d = u <= 109 ? 0 : Math.ceil((u - 109) / 127); l + u + d + 127 >> 7 > u;) d = ++u <= 109 ? 0 : Math.ceil((u - 109) / 127);
			var f = [
				1,
				d,
				u,
				c,
				o,
				n,
				t,
				0
			];
			return e.FileIndex[0].size = t << 6, f[7] = (e.FileIndex[0].start = f[0] + f[1] + f[2] + f[3] + f[4] + f[5]) + (f[6] + 7 >> 3), f;
		})(e), i = hr(r[7] << 9), a = 0, o = 0;
		for (a = 0; a < 8; ++a) i.write_shift(1, ne[a]);
		for (a = 0; a < 8; ++a) i.write_shift(2, 0);
		for (i.write_shift(2, 62), i.write_shift(2, 3), i.write_shift(2, 65534), i.write_shift(2, 9), i.write_shift(2, 6), a = 0; a < 3; ++a) i.write_shift(2, 0);
		for (i.write_shift(4, 0), i.write_shift(4, r[2]), i.write_shift(4, r[0] + r[1] + r[2] + r[3] - 1), i.write_shift(4, 0), i.write_shift(4, 4096), i.write_shift(4, r[3] ? r[0] + r[1] + r[2] - 1 : L), i.write_shift(4, r[3]), i.write_shift(-4, r[1] ? r[0] - 1 : L), i.write_shift(4, r[1]), a = 0; a < 109; ++a) i.write_shift(-4, a < r[2] ? r[1] + a : -1);
		if (r[1]) for (o = 0; o < r[1]; ++o) {
			for (; a < 236 + o * 127; ++a) i.write_shift(-4, a < r[2] ? r[1] + a : -1);
			i.write_shift(-4, o === r[1] - 1 ? L : o + 1);
		}
		var s = function(e) {
			for (o += e; a < o - 1; ++a) i.write_shift(-4, a + 1);
			e && (++a, i.write_shift(-4, L));
		};
		for (o = a = 0, o += r[1]; a < o; ++a) i.write_shift(-4, R.DIFSECT);
		for (o += r[2]; a < o; ++a) i.write_shift(-4, R.FATSECT);
		s(r[3]), s(r[4]);
		for (var c = 0, l = 0, u = e.FileIndex[0]; c < e.FileIndex.length; ++c) u = e.FileIndex[c], u.content && (l = u.content.length, !(l < 4096) && (u.start = o, s(l + 511 >> 9)));
		for (s(r[6] + 7 >> 3); i.l & 511;) i.write_shift(-4, R.ENDOFCHAIN);
		for (o = a = 0, c = 0; c < e.FileIndex.length; ++c) u = e.FileIndex[c], u.content && (l = u.content.length, !(!l || l >= 4096) && (u.start = o, s(l + 63 >> 6)));
		for (; i.l & 511;) i.write_shift(-4, R.ENDOFCHAIN);
		for (a = 0; a < r[4] << 2; ++a) {
			var d = e.FullPaths[a];
			if (!d || d.length === 0) {
				for (c = 0; c < 17; ++c) i.write_shift(4, 0);
				for (c = 0; c < 3; ++c) i.write_shift(4, -1);
				for (c = 0; c < 12; ++c) i.write_shift(4, 0);
				continue;
			}
			u = e.FileIndex[a], a === 0 && (u.start = u.size ? u.start - 1 : L);
			var f = a === 0 && n.root || u.name;
			if (f.length > 31 && (console.error("Name " + f + " will be truncated to " + f.slice(0, 31)), f = f.slice(0, 31)), l = 2 * (f.length + 1), i.write_shift(64, f, "utf16le"), i.write_shift(2, l), i.write_shift(1, u.type), i.write_shift(1, u.color), i.write_shift(-4, u.L), i.write_shift(-4, u.R), i.write_shift(-4, u.C), u.clsid) i.write_shift(16, u.clsid, "hex");
			else for (c = 0; c < 4; ++c) i.write_shift(4, 0);
			i.write_shift(4, u.state || 0), i.write_shift(4, 0), i.write_shift(4, 0), i.write_shift(4, 0), i.write_shift(4, 0), i.write_shift(4, u.start), i.write_shift(4, u.size), i.write_shift(4, 0);
		}
		for (a = 1; a < e.FileIndex.length; ++a) if (u = e.FileIndex[a], u.size >= 4096) if (i.l = u.start + 1 << 9, C && Buffer.isBuffer(u.content)) u.content.copy(i, i.l, 0, u.size), i.l += u.size + 511 & -512;
		else {
			for (c = 0; c < u.size; ++c) i.write_shift(1, u.content[c]);
			for (; c & 511; ++c) i.write_shift(1, 0);
		}
		for (a = 1; a < e.FileIndex.length; ++a) if (u = e.FileIndex[a], u.size > 0 && u.size < 4096) if (C && Buffer.isBuffer(u.content)) u.content.copy(i, i.l, 0, u.size), i.l += u.size + 63 & -64;
		else {
			for (c = 0; c < u.size; ++c) i.write_shift(1, u.content[c]);
			for (; c & 63; ++c) i.write_shift(1, 0);
		}
		if (C) i.l = i.length;
		else for (; i.l < i.length;) i.write_shift(1, 0);
		return i;
	}
	function F(e, t) {
		var n = e.FullPaths.map(function(e) {
			return e.toUpperCase();
		}), r = n.map(function(e) {
			var t = e.split("/");
			return t[t.length - (e.slice(-1) == "/" ? 2 : 1)];
		}), i = !1;
		t.charCodeAt(0) === 47 ? (i = !0, t = n[0].slice(0, -1) + t) : i = t.indexOf("/") !== -1;
		var a = t.toUpperCase(), o = i === !0 ? n.indexOf(a) : r.indexOf(a);
		if (o !== -1) return e.FileIndex[o];
		var s = !a.match(N);
		for (a = a.replace(M, ""), s && (a = a.replace(N, "!")), o = 0; o < n.length; ++o) if ((s ? n[o].replace(N, "!") : n[o]).replace(M, "") == a || (s ? r[o].replace(N, "!") : r[o]).replace(M, "") == a) return e.FileIndex[o];
		return null;
	}
	var I = 64, L = -2, te = "d0cf11e0a1b11ae1", ne = [
		208,
		207,
		17,
		224,
		161,
		177,
		26,
		225
	], re = "00000000000000000000000000000000", R = {
		MAXREGSECT: -6,
		DIFSECT: -4,
		FATSECT: -3,
		ENDOFCHAIN: L,
		FREESECT: -1,
		HEADER_SIGNATURE: te,
		HEADER_MINOR_VERSION: "3e00",
		MAXREGSID: -6,
		NOSTREAM: -1,
		HEADER_CLSID: re,
		EntryTypes: [
			"unknown",
			"storage",
			"stream",
			"lockbytes",
			"property",
			"root"
		]
	};
	function z(e, t, n) {
		c();
		var r = P(e, n);
		s.writeFileSync(t, r);
	}
	function B(e) {
		for (var t = Array(e.length), n = 0; n < e.length; ++n) t[n] = String.fromCharCode(e[n]);
		return t.join("");
	}
	function ie(e, t) {
		var n = P(e, t);
		switch (t && t.type || "buffer") {
			case "file": return c(), s.writeFileSync(t.filename, n), n;
			case "binary": return typeof n == "string" ? n : B(n);
			case "base64": return b(typeof n == "string" ? n : B(n));
			case "buffer": if (C) return Buffer.isBuffer(n) ? n : w(n);
			case "array": return typeof n == "string" ? O(n) : n;
		}
		return n;
	}
	var ae;
	function V(e) {
		try {
			var t = e.InflateRaw, n = new t();
			if (n._processChunk(new Uint8Array([3, 0]), n._finishFlushFlag), n.bytesRead) ae = e;
			else throw Error("zlib does not expose bytesRead");
		} catch (e) {
			console.error("cannot use native zlib: " + (e.message || e));
		}
	}
	function oe(e, t) {
		if (!ae) return Le(e, t);
		var n = ae.InflateRaw, r = new n(), i = r._processChunk(e.slice(e.l), r._finishFlushFlag);
		return e.l += r.bytesRead, i;
	}
	function se(e) {
		return ae ? ae.deflateRawSync(e) : G(e);
	}
	var ce = [
		16,
		17,
		18,
		0,
		8,
		7,
		9,
		6,
		10,
		5,
		11,
		4,
		12,
		3,
		13,
		2,
		14,
		1,
		15
	], le = [
		3,
		4,
		5,
		6,
		7,
		8,
		9,
		10,
		11,
		13,
		15,
		17,
		19,
		23,
		27,
		31,
		35,
		43,
		51,
		59,
		67,
		83,
		99,
		115,
		131,
		163,
		195,
		227,
		258
	], H = [
		1,
		2,
		3,
		4,
		5,
		7,
		9,
		13,
		17,
		25,
		33,
		49,
		65,
		97,
		129,
		193,
		257,
		385,
		513,
		769,
		1025,
		1537,
		2049,
		3073,
		4097,
		6145,
		8193,
		12289,
		16385,
		24577
	];
	function ue(e) {
		var t = (e << 1 | e << 11) & 139536 | (e << 5 | e << 15) & 558144;
		return (t >> 16 | t >> 8 | t) & 255;
	}
	for (var U = typeof Uint8Array < "u", W = U ? new Uint8Array(256) : [], de = 0; de < 256; ++de) W[de] = ue(de);
	function fe(e, t) {
		var n = W[e & 255];
		return t <= 8 ? n >>> 8 - t : (n = n << 8 | W[e >> 8 & 255], t <= 16 ? n >>> 16 - t : (n = n << 8 | W[e >> 16 & 255], n >>> 24 - t));
	}
	function pe(e, t) {
		var n = t & 7, r = t >>> 3;
		return (e[r] | (n <= 6 ? 0 : e[r + 1] << 8)) >>> n & 3;
	}
	function me(e, t) {
		var n = t & 7, r = t >>> 3;
		return (e[r] | (n <= 5 ? 0 : e[r + 1] << 8)) >>> n & 7;
	}
	function he(e, t) {
		var n = t & 7, r = t >>> 3;
		return (e[r] | (n <= 4 ? 0 : e[r + 1] << 8)) >>> n & 15;
	}
	function ge(e, t) {
		var n = t & 7, r = t >>> 3;
		return (e[r] | (n <= 3 ? 0 : e[r + 1] << 8)) >>> n & 31;
	}
	function _e(e, t) {
		var n = t & 7, r = t >>> 3;
		return (e[r] | (n <= 1 ? 0 : e[r + 1] << 8)) >>> n & 127;
	}
	function ve(e, t, n) {
		var r = t & 7, i = t >>> 3, a = (1 << n) - 1, o = e[i] >>> r;
		return n < 8 - r || (o |= e[i + 1] << 8 - r, n < 16 - r) || (o |= e[i + 2] << 16 - r, n < 24 - r) || (o |= e[i + 3] << 24 - r), o & a;
	}
	function ye(e, t, n) {
		var r = t & 7, i = t >>> 3;
		return r <= 5 ? e[i] |= (n & 7) << r : (e[i] |= n << r & 255, e[i + 1] = (n & 7) >> 8 - r), t + 3;
	}
	function be(e, t, n) {
		var r = t & 7, i = t >>> 3;
		return n = (n & 1) << r, e[i] |= n, t + 1;
	}
	function xe(e, t, n) {
		var r = t & 7, i = t >>> 3;
		return n <<= r, e[i] |= n & 255, n >>>= 8, e[i + 1] = n, t + 8;
	}
	function Se(e, t, n) {
		var r = t & 7, i = t >>> 3;
		return n <<= r, e[i] |= n & 255, n >>>= 8, e[i + 1] = n & 255, e[i + 2] = n >>> 8, t + 16;
	}
	function Ce(e, t) {
		var n = e.length, r = 2 * n > t ? 2 * n : t + 5, i = 0;
		if (n >= t) return e;
		if (C) {
			var a = D(r);
			if (e.copy) e.copy(a);
			else for (; i < e.length; ++i) a[i] = e[i];
			return a;
		} else if (U) {
			var o = new Uint8Array(r);
			if (o.set) o.set(e);
			else for (; i < n; ++i) o[i] = e[i];
			return o;
		}
		return e.length = r, e;
	}
	function we(e) {
		for (var t = Array(e), n = 0; n < e; ++n) t[n] = 0;
		return t;
	}
	function Te(e, t, n) {
		var r = 1, i = 0, a = 0, o = 0, s = 0, c = e.length, l = U ? new Uint16Array(32) : we(32);
		for (a = 0; a < 32; ++a) l[a] = 0;
		for (a = c; a < n; ++a) e[a] = 0;
		c = e.length;
		var u = U ? new Uint16Array(c) : we(c);
		for (a = 0; a < c; ++a) l[i = e[a]]++, r < i && (r = i), u[a] = 0;
		for (l[0] = 0, a = 1; a <= r; ++a) l[a + 16] = s = s + l[a - 1] << 1;
		for (a = 0; a < c; ++a) s = e[a], s != 0 && (u[a] = l[s + 16]++);
		var d = 0;
		for (a = 0; a < c; ++a) if (d = e[a], d != 0) for (s = fe(u[a], r) >> r - d, o = (1 << r + 4 - d) - 1; o >= 0; --o) t[s | o << d] = d & 15 | a << 4;
		return r;
	}
	var Ee = U ? new Uint16Array(512) : we(512), De = U ? new Uint16Array(32) : we(32);
	if (!U) {
		for (var Oe = 0; Oe < 512; ++Oe) Ee[Oe] = 0;
		for (Oe = 0; Oe < 32; ++Oe) De[Oe] = 0;
	}
	(function() {
		for (var e = [], t = 0; t < 32; t++) e.push(5);
		Te(e, De, 32);
		var n = [];
		for (t = 0; t <= 143; t++) n.push(8);
		for (; t <= 255; t++) n.push(9);
		for (; t <= 279; t++) n.push(7);
		for (; t <= 287; t++) n.push(8);
		Te(n, Ee, 288);
	})();
	var ke = /*#__PURE__*/ (function() {
		for (var e = U ? new Uint8Array(32768) : [], t = 0, n = 0; t < H.length - 1; ++t) for (; n < H[t + 1]; ++n) e[n] = t;
		for (; n < 32768; ++n) e[n] = 29;
		var r = U ? new Uint8Array(259) : [];
		for (t = 0, n = 0; t < le.length - 1; ++t) for (; n < le[t + 1]; ++n) r[n] = t;
		function i(e, t) {
			for (var n = 0; n < e.length;) {
				var r = Math.min(65535, e.length - n), i = n + r == e.length;
				for (t.write_shift(1, +i), t.write_shift(2, r), t.write_shift(2, ~r & 65535); r-- > 0;) t[t.l++] = e[n++];
			}
			return t.l;
		}
		function a(t, n) {
			for (var i = 0, a = 0, o = U ? new Uint16Array(32768) : []; a < t.length;) {
				var s = Math.min(65535, t.length - a);
				if (s < 10) {
					for (i = ye(n, i, +(a + s == t.length)), i & 7 && (i += 8 - (i & 7)), n.l = i / 8 | 0, n.write_shift(2, s), n.write_shift(2, ~s & 65535); s-- > 0;) n[n.l++] = t[a++];
					i = n.l * 8;
					continue;
				}
				i = ye(n, i, +(a + s == t.length) + 2);
				for (var c = 0; s-- > 0;) {
					var l = t[a];
					c = (c << 5 ^ l) & 32767;
					var u = -1, d = 0;
					if ((u = o[c]) && (u |= a & -32768, u > a && (u -= 32768), u < a)) for (; t[u + d] == t[a + d] && d < 250;) ++d;
					if (d > 2) {
						l = r[d], l <= 22 ? i = xe(n, i, W[l + 1] >> 1) - 1 : (xe(n, i, 3), i += 5, xe(n, i, W[l - 23] >> 5), i += 3);
						var f = l < 8 ? 0 : l - 4 >> 2;
						f > 0 && (Se(n, i, d - le[l]), i += f), l = e[a - u], i = xe(n, i, W[l] >> 3), i -= 3;
						var p = l < 4 ? 0 : l - 2 >> 1;
						p > 0 && (Se(n, i, a - u - H[l]), i += p);
						for (var m = 0; m < d; ++m) o[c] = a & 32767, c = (c << 5 ^ t[a]) & 32767, ++a;
						s -= d - 1;
					} else l <= 143 ? l += 48 : i = be(n, i, 1), i = xe(n, i, W[l]), o[c] = a & 32767, ++a;
				}
				i = xe(n, i, 0) - 1;
			}
			return n.l = (i + 7) / 8 | 0, n.l;
		}
		return function(e, t) {
			return e.length < 8 ? i(e, t) : a(e, t);
		};
	})();
	function G(e) {
		var t = hr(50 + Math.floor(e.length * 1.1)), n = ke(e, t);
		return t.slice(0, n);
	}
	var Ae = U ? new Uint16Array(32768) : we(32768), je = U ? new Uint16Array(32768) : we(32768), Me = U ? new Uint16Array(128) : we(128), Ne = 1, Pe = 1;
	function Fe(e, t) {
		var n = ge(e, t) + 257;
		t += 5;
		var r = ge(e, t) + 1;
		t += 5;
		var i = he(e, t) + 4;
		t += 4;
		for (var a = 0, o = U ? new Uint8Array(19) : we(19), s = [
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0
		], c = 1, l = U ? new Uint8Array(8) : we(8), u = U ? new Uint8Array(8) : we(8), d = o.length, f = 0; f < i; ++f) o[ce[f]] = a = me(e, t), c < a && (c = a), l[a]++, t += 3;
		var p = 0;
		for (l[0] = 0, f = 1; f <= c; ++f) u[f] = p = p + l[f - 1] << 1;
		for (f = 0; f < d; ++f) (p = o[f]) != 0 && (s[f] = u[p]++);
		var m = 0;
		for (f = 0; f < d; ++f) if (m = o[f], m != 0) {
			p = W[s[f]] >> 8 - m;
			for (var h = (1 << 7 - m) - 1; h >= 0; --h) Me[p | h << m] = m & 7 | f << 3;
		}
		var g = [];
		for (c = 1; g.length < n + r;) switch (p = Me[_e(e, t)], t += p & 7, p >>>= 3) {
			case 16:
				for (a = 3 + pe(e, t), t += 2, p = g[g.length - 1]; a-- > 0;) g.push(p);
				break;
			case 17:
				for (a = 3 + me(e, t), t += 3; a-- > 0;) g.push(0);
				break;
			case 18:
				for (a = 11 + _e(e, t), t += 7; a-- > 0;) g.push(0);
				break;
			default:
				g.push(p), c < p && (c = p);
				break;
		}
		var _ = g.slice(0, n), v = g.slice(n);
		for (f = n; f < 286; ++f) _[f] = 0;
		for (f = r; f < 30; ++f) v[f] = 0;
		return Ne = Te(_, Ae, 286), Pe = Te(v, je, 30), t;
	}
	function Ie(e, t) {
		if (e[0] == 3 && !(e[1] & 3)) return [E(t), 2];
		for (var n = 0, r = 0, i = D(t || 1 << 18), a = 0, o = i.length >>> 0, s = 0, c = 0; !(r & 1);) {
			if (r = me(e, n), n += 3, r >>> 1) r >> 1 == 1 ? (s = 9, c = 5) : (n = Fe(e, n), s = Ne, c = Pe);
			else {
				n & 7 && (n += 8 - (n & 7));
				var l = e[n >>> 3] | e[(n >>> 3) + 1] << 8;
				if (n += 32, l > 0) for (!t && o < a + l && (i = Ce(i, a + l), o = i.length); l-- > 0;) i[a++] = e[n >>> 3], n += 8;
				continue;
			}
			for (;;) {
				!t && o < a + 32767 && (i = Ce(i, a + 32767), o = i.length);
				var u = ve(e, n, s), d = r >>> 1 == 1 ? Ee[u] : Ae[u];
				if (n += d & 15, d >>>= 4, !(d >>> 8 & 255)) i[a++] = d;
				else if (d == 256) break;
				else {
					d -= 257;
					var f = d < 8 ? 0 : d - 4 >> 2;
					f > 5 && (f = 0);
					var p = a + le[d];
					f > 0 && (p += ve(e, n, f), n += f), u = ve(e, n, c), d = r >>> 1 == 1 ? De[u] : je[u], n += d & 15, d >>>= 4;
					var m = d < 4 ? 0 : d - 2 >> 1, h = H[d];
					for (m > 0 && (h += ve(e, n, m), n += m), !t && o < p && (i = Ce(i, p + 100), o = i.length); a < p;) i[a] = i[a - h], ++a;
				}
			}
		}
		return t ? [i, n + 7 >>> 3] : [i.slice(0, a), n + 7 >>> 3];
	}
	function Le(e, t) {
		var n = Ie(e.slice(e.l || 0), t);
		return e.l += n[1], n[0];
	}
	function Re(e, t) {
		if (e) typeof console < "u" && console.error(t);
		else throw Error(t);
	}
	function ze(e, t) {
		var n = e;
		pr(n, 0);
		var r = {
			FileIndex: [],
			FullPaths: []
		};
		k(r, { root: t.root });
		for (var i = n.length - 4; (n[i] != 80 || n[i + 1] != 75 || n[i + 2] != 5 || n[i + 3] != 6) && i >= 0;) --i;
		n.l = i + 4, n.l += 4;
		var a = n.read_shift(2);
		for (n.l += 6, n.l = n.read_shift(4), i = 0; i < a; ++i) {
			n.l += 20;
			var s = n.read_shift(4), c = n.read_shift(4), l = n.read_shift(2), u = n.read_shift(2), d = n.read_shift(2);
			n.l += 8;
			var f = n.read_shift(4), p = o(n.slice(n.l + l, n.l + l + u));
			n.l += l + u + d;
			var m = n.l;
			n.l = f + 4, p && p[1] && ((p[1] || {}).usz && (c = p[1].usz), (p[1] || {}).csz && (s = p[1].csz)), Be(n, s, c, r, p), n.l = m;
		}
		return r;
	}
	function Be(e, t, n, r, i) {
		e.l += 2;
		var s = e.read_shift(2), c = e.read_shift(2), l = a(e);
		if (s & 8257) throw Error("Unsupported ZIP encryption");
		for (var u = e.read_shift(4), d = e.read_shift(4), f = e.read_shift(4), p = e.read_shift(2), m = e.read_shift(2), h = "", g = 0; g < p; ++g) h += String.fromCharCode(e[e.l++]);
		if (m) {
			var _ = o(e.slice(e.l, e.l + m));
			(_[21589] || {}).mt && (l = _[21589].mt), (_[1] || {}).usz && (f = _[1].usz), (_[1] || {}).csz && (d = _[1].csz), i && ((i[21589] || {}).mt && (l = i[21589].mt), (i[1] || {}).usz && (f = i[1].usz), (i[1] || {}).csz && (d = i[1].csz));
		}
		e.l += m;
		var v = e.slice(e.l, e.l + d);
		switch (c) {
			case 8:
				v = oe(e, f);
				break;
			case 0:
				e.l += d;
				break;
			default: throw Error("Unsupported ZIP Compression method " + c);
		}
		var y = !1;
		s & 8 && (u = e.read_shift(4), u == 134695760 && (u = e.read_shift(4), y = !0), d = e.read_shift(4), f = e.read_shift(4)), d != t && Re(y, "Bad compressed size: " + t + " != " + d), f != n && Re(y, "Bad uncompressed size: " + n + " != " + f), Ze(r, h, v, {
			unsafe: !0,
			mt: l
		});
	}
	function Ve(e, t) {
		var n = t || {}, r = [], a = [], o = hr(1), s = n.compression ? 8 : 0, c = 0, l = 0, u = 0, d = 0, f = 0, p = e.FullPaths[0], m = p, h = e.FileIndex[0], g = [], _ = 0;
		for (l = 1; l < e.FullPaths.length; ++l) if (m = e.FullPaths[l].slice(p.length), h = e.FileIndex[l], !(!h.size || !h.content || Array.isArray(h.content) && h.content.length == 0 || m == "Sh33tJ5")) {
			var v = d, y = hr(m.length);
			for (u = 0; u < m.length; ++u) y.write_shift(1, m.charCodeAt(u) & 127);
			y = y.slice(0, y.l), g[f] = typeof h.content == "string" ? $e.bstr(h.content, 0) : $e.buf(h.content, 0);
			var b = typeof h.content == "string" ? O(h.content) : h.content;
			s == 8 && (b = se(b)), o = hr(30), o.write_shift(4, 67324752), o.write_shift(2, 20), o.write_shift(2, c), o.write_shift(2, s), h.mt ? i(o, h.mt) : o.write_shift(4, 0), o.write_shift(-4, c & 8 ? 0 : g[f]), o.write_shift(4, c & 8 ? 0 : b.length), o.write_shift(4, c & 8 ? 0 : h.content.length), o.write_shift(2, y.length), o.write_shift(2, 0), d += o.length, r.push(o), d += y.length, r.push(y), d += b.length, r.push(b), c & 8 && (o = hr(12), o.write_shift(-4, g[f]), o.write_shift(4, b.length), o.write_shift(4, h.content.length), d += o.l, r.push(o)), o = hr(46), o.write_shift(4, 33639248), o.write_shift(2, 0), o.write_shift(2, 20), o.write_shift(2, c), o.write_shift(2, s), o.write_shift(4, 0), o.write_shift(-4, g[f]), o.write_shift(4, b.length), o.write_shift(4, h.content.length), o.write_shift(2, y.length), o.write_shift(2, 0), o.write_shift(2, 0), o.write_shift(2, 0), o.write_shift(2, 0), o.write_shift(4, 0), o.write_shift(4, v), _ += o.l, a.push(o), _ += y.length, a.push(y), ++f;
		}
		return o = hr(22), o.write_shift(4, 101010256), o.write_shift(2, 0), o.write_shift(2, 0), o.write_shift(2, f), o.write_shift(2, f), o.write_shift(4, _), o.write_shift(4, d), o.write_shift(2, 0), j([
			j(r),
			j(a),
			o
		]);
	}
	var He = {
		htm: "text/html",
		xml: "text/xml",
		gif: "image/gif",
		jpg: "image/jpeg",
		png: "image/png",
		mso: "application/x-mso",
		thmx: "application/vnd.ms-officetheme",
		sh33tj5: "application/octet-stream"
	};
	function Ue(e, t) {
		if (e.ctype) return e.ctype;
		var n = e.name || "", r = n.match(/\.([^\.]+)$/);
		return r && He[r[1]] || t && (r = (n = t).match(/[\.\\]([^\.\\])+$/), r && He[r[1]]) ? He[r[1]] : "application/octet-stream";
	}
	function We(e) {
		for (var t = b(e), n = [], r = 0; r < t.length; r += 76) n.push(t.slice(r, r + 76));
		return n.join("\r\n") + "\r\n";
	}
	function Ge(e) {
		var t = e.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7E-\xFF=]/g, function(e) {
			var t = e.charCodeAt(0).toString(16).toUpperCase();
			return "=" + (t.length == 1 ? "0" + t : t);
		});
		t = t.replace(/ $/gm, "=20").replace(/\t$/gm, "=09"), t.charAt(0) == "\n" && (t = "=0D" + t.slice(1)), t = t.replace(/\r(?!\n)/gm, "=0D").replace(/\n\n/gm, "\n=0A").replace(/([^\r\n])\n/gm, "$1=0A");
		for (var n = [], r = t.split("\r\n"), i = 0; i < r.length; ++i) {
			var a = r[i];
			if (a.length == 0) {
				n.push("");
				continue;
			}
			for (var o = 0; o < a.length;) {
				var s = 76, c = a.slice(o, o + s);
				c.charAt(s - 1) == "=" ? s-- : c.charAt(s - 2) == "=" ? s -= 2 : c.charAt(s - 3) == "=" && (s -= 3), c = a.slice(o, o + s), o += s, o < a.length && (c += "="), n.push(c);
			}
		}
		return n.join("\r\n");
	}
	function Ke(e) {
		for (var t = [], n = 0; n < e.length; ++n) {
			for (var r = e[n]; n <= e.length && r.charAt(r.length - 1) == "=";) r = r.slice(0, r.length - 1) + e[++n];
			t.push(r);
		}
		for (var i = 0; i < t.length; ++i) t[i] = t[i].replace(/[=][0-9A-Fa-f]{2}/g, function(e) {
			return String.fromCharCode(parseInt(e.slice(1), 16));
		});
		return O(t.join("\r\n"));
	}
	function qe(e, t, n) {
		for (var r = "", i = "", a = "", o, s = 0; s < 10; ++s) {
			var c = t[s];
			if (!c || c.match(/^\s*$/)) break;
			var l = c.match(/^([^:]*?):\s*([^\s].*)$/);
			if (l) switch (l[1].toLowerCase()) {
				case "content-location":
					r = l[2].trim();
					break;
				case "content-type":
					a = l[2].trim();
					break;
				case "content-transfer-encoding":
					i = l[2].trim();
					break;
			}
		}
		switch (++s, i.toLowerCase()) {
			case "base64":
				o = O(S(t.slice(s).join("")));
				break;
			case "quoted-printable":
				o = Ke(t.slice(s));
				break;
			default: throw Error("Unsupported Content-Transfer-Encoding " + i);
		}
		var u = Ze(e, r.slice(n.length), o, { unsafe: !0 });
		a && (u.ctype = a);
	}
	function Je(e, t) {
		if (B(e.slice(0, 13)).toLowerCase() != "mime-version:") throw Error("Unsupported MAD header");
		var n = t && t.root || "", r = (C && Buffer.isBuffer(e) ? e.toString("binary") : B(e)).split("\r\n"), i = 0, a = "";
		for (i = 0; i < r.length; ++i) if (a = r[i], /^Content-Location:/i.test(a) && (a = a.slice(a.indexOf("file")), n || (n = a.slice(0, a.lastIndexOf("/") + 1)), a.slice(0, n.length) != n)) for (; n.length > 0 && (n = n.slice(0, n.length - 1), n = n.slice(0, n.lastIndexOf("/") + 1), a.slice(0, n.length) != n););
		var o = (r[1] || "").match(/boundary="(.*?)"/);
		if (!o) throw Error("MAD cannot find boundary");
		var s = "--" + (o[1] || ""), c = {
			FileIndex: [],
			FullPaths: []
		};
		k(c);
		var l, u = 0;
		for (i = 0; i < r.length; ++i) {
			var d = r[i];
			d !== s && d !== s + "--" || (u++ && qe(c, r.slice(l, i), n), l = i);
		}
		return c;
	}
	function Ye(e, t) {
		var n = t || {}, r = n.boundary || "SheetJS";
		r = "------=" + r;
		for (var i = [
			"MIME-Version: 1.0",
			"Content-Type: multipart/related; boundary=\"" + r.slice(2) + "\"",
			"",
			"",
			""
		], a = e.FullPaths[0], o = a, s = e.FileIndex[0], c = 1; c < e.FullPaths.length; ++c) if (o = e.FullPaths[c].slice(a.length), s = e.FileIndex[c], !(!s.size || !s.content || o == "Sh33tJ5")) {
			o = o.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7E-\xFF]/g, function(e) {
				return "_x" + e.charCodeAt(0).toString(16) + "_";
			}).replace(/[\u0080-\uFFFF]/g, function(e) {
				return "_u" + e.charCodeAt(0).toString(16) + "_";
			});
			for (var l = s.content, u = C && Buffer.isBuffer(l) ? l.toString("binary") : B(l), d = 0, f = Math.min(1024, u.length), p = 0, m = 0; m <= f; ++m) (p = u.charCodeAt(m)) >= 32 && p < 128 && ++d;
			var h = d >= f * 4 / 5;
			i.push(r), i.push("Content-Location: " + (n.root || "file:///C:/SheetJS/") + o), i.push("Content-Transfer-Encoding: " + (h ? "quoted-printable" : "base64")), i.push("Content-Type: " + Ue(s, o)), i.push(""), i.push(h ? Ge(u) : We(u));
		}
		return i.push(r + "--\r\n"), i.join("\r\n");
	}
	function Xe(e) {
		var t = {};
		return k(t, e), t;
	}
	function Ze(e, t, n, i) {
		var a = i && i.unsafe;
		a || k(e);
		var o = !a && et.find(e, t);
		if (!o) {
			var s = e.FullPaths[0];
			t.slice(0, s.length) == s ? s = t : (s.slice(-1) != "/" && (s += "/"), s = (s + t).replace("//", "/")), o = {
				name: r(t),
				type: 2
			}, e.FileIndex.push(o), e.FullPaths.push(s), a || et.utils.cfb_gc(e);
		}
		return o.content = n, o.size = n ? n.length : 0, i && (i.CLSID && (o.clsid = i.CLSID), i.mt && (o.mt = i.mt), i.ct && (o.ct = i.ct)), o;
	}
	function Qe(e, t) {
		k(e);
		var n = et.find(e, t);
		if (n) {
			for (var r = 0; r < e.FileIndex.length; ++r) if (e.FileIndex[r] == n) return e.FileIndex.splice(r, 1), e.FullPaths.splice(r, 1), !0;
		}
		return !1;
	}
	function nt(e, t, n) {
		k(e);
		var i = et.find(e, t);
		if (i) {
			for (var a = 0; a < e.FileIndex.length; ++a) if (e.FileIndex[a] == i) return e.FileIndex[a].name = r(n), e.FullPaths[a] = n, !0;
		}
		return !1;
	}
	function rt(e) {
		ee(e, !0);
	}
	return e.find = F, e.read = T, e.parse = l, e.write = ie, e.writeFile = z, e.utils = {
		cfb_new: Xe,
		cfb_add: Ze,
		cfb_del: Qe,
		cfb_mov: nt,
		cfb_gc: rt,
		ReadShift: sr,
		CheckField: fr,
		prep_blob: pr,
		bconcat: j,
		use_zlib: V,
		_deflateRaw: G,
		_inflateRaw: Le,
		consts: R
	}, e;
})(), tt;
function nt(e) {
	if (tt !== void 0) return tt.readFileSync(e);
	if (typeof Deno < "u") return Deno.readFileSync(e);
	if (typeof $ < "u" && typeof File < "u" && typeof Folder < "u") try {
		var t = File(e);
		t.open("r"), t.encoding = "binary";
		var n = t.read();
		return t.close(), n;
	} catch (e) {
		if (!e.message || e.message.indexOf("onstruct") == -1) throw e;
	}
	throw Error("Cannot access file " + e);
}
function rt(e) {
	for (var t = Object.keys(e), n = [], r = 0; r < t.length; ++r) Object.prototype.hasOwnProperty.call(e, t[r]) && n.push(t[r]);
	return n;
}
function it(e) {
	for (var t = [], n = rt(e), r = 0; r !== n.length; ++r) t[e[n[r]]] = n[r];
	return t;
}
var at = /*#__PURE__*/ Date.UTC(1899, 11, 30, 0, 0, 0), ot = /*#__PURE__*/ Date.UTC(1899, 11, 31, 0, 0, 0), st = /*#__PURE__*/ Date.UTC(1904, 0, 1, 0, 0, 0);
function ct(e, t) {
	var n = (/* @__PURE__ */ e.getTime() - at) / (1440 * 60 * 1e3);
	return t ? (n -= 1462, n < -1402 ? n - 1 : n) : n < 60 ? n - 1 : n;
}
function lt(e) {
	if (e >= 60 && e < 61) return e;
	var t = /* @__PURE__ */ new Date();
	return t.setTime((e > 60 ? e : e + 1) * 24 * 60 * 60 * 1e3 + at), t;
}
function ut(e) {
	var t = 0, n = 0, r = !1, i = e.match(/P([0-9\.]+Y)?([0-9\.]+M)?([0-9\.]+D)?T([0-9\.]+H)?([0-9\.]+M)?([0-9\.]+S)?/);
	if (!i) throw Error("|" + e + "| is not an ISO8601 Duration");
	for (var a = 1; a != i.length; ++a) if (i[a]) {
		switch (n = 1, a > 3 && (r = !0), i[a].slice(i[a].length - 1)) {
			case "Y": throw Error("Unsupported ISO Duration Field: " + i[a].slice(i[a].length - 1));
			case "D": n *= 24;
			case "H": n *= 60;
			case "M": if (r) n *= 60;
			else throw Error("Unsupported ISO Duration Field: M");
			case "S": break;
		}
		t += n * parseInt(i[a], 10);
	}
	return t;
}
var dt = /^(\d+):(\d+)(:\d+)?(\.\d+)?$/, ft = /^(\d+)-(\d+)-(\d+)$/, pt = /^(\d+)-(\d+)-(\d+)[T ](\d+):(\d+)(:\d+)?(\.\d+)?$/;
function mt(e, t) {
	if (e instanceof Date) return e;
	var n = e.match(dt);
	return n ? new Date((t ? st : ot) + ((parseInt(n[1], 10) * 60 + parseInt(n[2], 10)) * 60 + (n[3] ? parseInt(n[3].slice(1), 10) : 0)) * 1e3 + (n[4] ? parseInt((n[4] + "000").slice(1, 4), 10) : 0)) : (n = e.match(ft), n ? new Date(Date.UTC(+n[1], n[2] - 1, +n[3], 0, 0, 0, 0)) : (n = e.match(pt), n ? new Date(Date.UTC(+n[1], n[2] - 1, +n[3], +n[4], +n[5], n[6] && parseInt(n[6].slice(1), 10) || 0, n[7] && parseInt((n[7] + "0000").slice(1, 4), 10) || 0)) : new Date(e)));
}
function ht(e, t) {
	if (C && Buffer.isBuffer(e)) {
		if (t && T) {
			if (e[0] == 255 && e[1] == 254) return yn(e.slice(2).toString("utf16le"));
			if (e[1] == 254 && e[2] == 255) return yn(p(e.slice(2).toString("binary")));
		}
		return e.toString("binary");
	}
	if (typeof TextDecoder < "u") try {
		if (t) {
			if (e[0] == 255 && e[1] == 254) return yn(new TextDecoder("utf-16le").decode(e.slice(2)));
			if (e[0] == 254 && e[1] == 255) return yn(new TextDecoder("utf-16be").decode(e.slice(2)));
		}
		var n = {
			"€": "",
			"‚": "",
			ƒ: "",
			"„": "",
			"…": "",
			"†": "",
			"‡": "",
			ˆ: "",
			"‰": "",
			Š: "",
			"‹": "",
			Œ: "",
			Ž: "",
			"‘": "",
			"’": "",
			"“": "",
			"”": "",
			"•": "",
			"–": "",
			"—": "",
			"˜": "",
			"™": "",
			š: "",
			"›": "",
			œ: "",
			ž: "",
			Ÿ: ""
		};
		return Array.isArray(e) && (e = new Uint8Array(e)), new TextDecoder("latin1").decode(e).replace(/[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, function(e) {
			return n[e] || e;
		});
	} catch {}
	var r = [], i = 0;
	try {
		for (i = 0; i < e.length - 65536; i += 65536) r.push(String.fromCharCode.apply(0, e.slice(i, i + 65536)));
		r.push(String.fromCharCode.apply(0, e.slice(i)));
	} catch {
		try {
			for (; i < e.length - 16384; i += 16384) r.push(String.fromCharCode.apply(0, e.slice(i, i + 16384)));
			r.push(String.fromCharCode.apply(0, e.slice(i)));
		} catch {
			for (; i != e.length; ++i) r.push(String.fromCharCode(e[i]));
		}
	}
	return r.join("");
}
function gt(e) {
	if (typeof JSON < "u" && !Array.isArray(e)) return JSON.parse(JSON.stringify(e));
	if (typeof e != "object" || !e) return e;
	if (e instanceof Date) return new Date(e.getTime());
	var t = {};
	for (var n in e) Object.prototype.hasOwnProperty.call(e, n) && (t[n] = gt(e[n]));
	return t;
}
function _t(e, t) {
	for (var n = ""; n.length < t;) n += e;
	return n;
}
function vt(e) {
	var t = Number(e);
	if (!isNaN(t)) return isFinite(t) ? t : NaN;
	if (!/\d/.test(e)) return t;
	var n = 1, r = e.replace(/([\d]),([\d])/g, "$1$2").replace(/[$]/g, "").replace(/[%]/g, function() {
		return n *= 100, "";
	});
	return !isNaN(t = Number(r)) || (r = r.replace(/[(]([^()]*)[)]/, function(e, t) {
		return n = -n, t;
	}), !isNaN(t = Number(r))) ? t / n : t;
}
var yt = /^(0?\d|1[0-2])(?:|:([0-5]?\d)(?:|(\.\d+)(?:|:([0-5]?\d))|:([0-5]?\d)(|\.\d+)))\s+([ap])m?$/, bt = /^([01]?\d|2[0-3])(?:|:([0-5]?\d)(?:|(\.\d+)(?:|:([0-5]?\d))|:([0-5]?\d)(|\.\d+)))$/, xt = /^(\d+)-(\d+)-(\d+)[T ](\d+):(\d+)(:\d+)(\.\d+)?[Z]?$/, St = (/* @__PURE__ */ new Date("6/9/69 00:00 UTC")).valueOf() == -177984e5;
function Ct(e) {
	return e[2] ? e[3] ? e[4] ? new Date(Date.UTC(1899, 11, 31, e[1] % 12 + (e[7] == "p" ? 12 : 0), +e[2], +e[4], parseFloat(e[3]) * 1e3)) : new Date(Date.UTC(1899, 11, 31, e[7] == "p" ? 12 : 0, +e[1], +e[2], parseFloat(e[3]) * 1e3)) : e[5] ? new Date(Date.UTC(1899, 11, 31, e[1] % 12 + (e[7] == "p" ? 12 : 0), +e[2], +e[5], e[6] ? parseFloat(e[6]) * 1e3 : 0)) : new Date(Date.UTC(1899, 11, 31, e[1] % 12 + (e[7] == "p" ? 12 : 0), +e[2], 0, 0)) : new Date(Date.UTC(1899, 11, 31, e[1] % 12 + (e[7] == "p" ? 12 : 0), 0, 0, 0));
}
function wt(e) {
	return e[2] ? e[3] ? e[4] ? new Date(Date.UTC(1899, 11, 31, +e[1], +e[2], +e[4], parseFloat(e[3]) * 1e3)) : new Date(Date.UTC(1899, 11, 31, 0, +e[1], +e[2], parseFloat(e[3]) * 1e3)) : e[5] ? new Date(Date.UTC(1899, 11, 31, +e[1], +e[2], +e[5], e[6] ? parseFloat(e[6]) * 1e3 : 0)) : new Date(Date.UTC(1899, 11, 31, +e[1], +e[2], 0, 0)) : new Date(Date.UTC(1899, 11, 31, +e[1], 0, 0, 0));
}
var Tt = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december"
];
function Et(e) {
	if (xt.test(e)) return e.indexOf("Z") == -1 ? kt(new Date(e)) : new Date(e);
	var t = e.toLowerCase(), n = t.replace(/\s+/g, " ").trim(), r = n.match(yt);
	if (r) return Ct(r);
	if (r = n.match(bt), r) return wt(r);
	if (r = n.match(pt), r) return new Date(Date.UTC(+r[1], r[2] - 1, +r[3], +r[4], +r[5], r[6] && parseInt(r[6].slice(1), 10) || 0, r[7] && parseInt((r[7] + "0000").slice(1, 4), 10) || 0));
	var i = new Date(St && e.indexOf("UTC") == -1 ? e + " UTC" : e), a = /* @__PURE__ */ new Date(NaN), o = i.getYear();
	i.getMonth();
	var s = i.getDate();
	if (isNaN(s)) return a;
	if (t.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/)) {
		if (t = t.replace(/[^a-z]/g, "").replace(/([^a-z]|^)[ap]m?([^a-z]|$)/, ""), t.length > 3 && Tt.indexOf(t) == -1) return a;
	} else if (t.replace(/[ap]m?/, "").match(/[a-z]/)) return a;
	return o < 0 || o > 8099 || e.match(/[^-0-9:,\/\\\ ]/) ? a : i;
}
var Dt = /*#__PURE__*/ (function() {
	var e = "abacaba".split(/(:?b)/i).length == 5;
	return function(t, n, r) {
		if (e || typeof n == "string") return t.split(n);
		for (var i = t.split(n), a = [i[0]], o = 1; o < i.length; ++o) a.push(r), a.push(i[o]);
		return a;
	};
})();
function Ot(e) {
	return new Date(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate(), e.getUTCHours(), e.getUTCMinutes(), e.getUTCSeconds(), e.getUTCMilliseconds());
}
function kt(e) {
	return new Date(Date.UTC(e.getFullYear(), e.getMonth(), e.getDate(), e.getHours(), e.getMinutes(), e.getSeconds(), e.getMilliseconds()));
}
function At(e) {
	var t = e.slice(0, 1024).indexOf("<!DOCTYPE");
	if (t == -1) return e;
	var n = e.match(/<[\w]/);
	return n ? e.slice(0, t) + e.slice(n.index) : e;
}
function jt(e, t, n) {
	for (var r = [], i = e.indexOf(t); i > -1;) {
		var a = e.indexOf(n, i + t.length);
		if (a == -1) break;
		r.push(e.slice(i, a + n.length)), i = e.indexOf(t, a + n.length);
	}
	return r.length > 0 ? r : null;
}
function Mt(e, t, n) {
	var r = [], i = 0, a = e.indexOf(t);
	if (a == -1) return e;
	for (; a > -1;) {
		r.push(e.slice(i, a));
		var o = e.indexOf(n, a + t.length);
		if (o == -1) break;
		(a = e.indexOf(t, i = o + n.length)) == -1 && r.push(e.slice(i));
	}
	return r.join("");
}
var Nt = {
	" ": 1,
	"	": 1,
	"\r": 1,
	"\n": 1,
	">": 1
};
function Pt(e, t) {
	for (var n = e.indexOf("<" + t), r = t.length + 1, i = e.length; n >= 0 && n <= i - r && !Nt[e.charAt(n + r)];) n = e.indexOf("<" + t, n + 1);
	if (n === -1) return null;
	var a = e.indexOf(">", n + t.length);
	if (a === -1) return null;
	var o = "</" + t + ">", s = e.indexOf(o, a);
	return s == -1 ? null : [e.slice(n, s + o.length), e.slice(a + 1, s)];
}
var Ft = /*#__PURE__*/ (function() {
	var e = {};
	return function(t, n) {
		var r = e[n];
		r || (e[n] = r = [RegExp("<(?:\\w+:)?" + n + "\\b[^<>]*>", "g"), RegExp("</(?:\\w+:)?" + n + ">", "g")]), r[0].lastIndex = r[1].lastIndex = 0;
		var i = r[0].exec(t);
		if (!i) return null;
		var a = i.index, o = r[0].lastIndex;
		if (r[1].lastIndex = r[0].lastIndex, i = r[1].exec(t), !i) return null;
		var s = i.index, c = r[1].lastIndex;
		return [t.slice(a, c), t.slice(o, s)];
	};
})(), It = /*#__PURE__*/ (function() {
	var e = {};
	return function(t, n) {
		var r = [], i = e[n];
		i || (e[n] = i = [RegExp("<(?:\\w+:)?" + n + "\\b[^<>]*>", "g"), RegExp("</(?:\\w+:)?" + n + ">", "g")]), i[0].lastIndex = i[1].lastIndex = 0;
		for (var a; a = i[0].exec(t);) {
			var o = a.index;
			if (i[1].lastIndex = i[0].lastIndex, a = i[1].exec(t), !a) return null;
			var s = i[1].lastIndex;
			r.push(t.slice(o, s)), i[0].lastIndex = i[1].lastIndex;
		}
		return r.length == 0 ? null : r;
	};
})(), Lt = /*#__PURE__*/ (function() {
	var e = {};
	return function(t, n) {
		var r = [], i = e[n];
		i || (e[n] = i = [RegExp("<(?:\\w+:)?" + n + "\\b[^<>]*>", "g"), RegExp("</(?:\\w+:)?" + n + ">", "g")]), i[0].lastIndex = i[1].lastIndex = 0;
		for (var a, o = 0, s = 0; a = i[0].exec(t);) {
			if (o = a.index, r.push(t.slice(s, o)), s = o, i[1].lastIndex = i[0].lastIndex, a = i[1].exec(t), !a) return null;
			s = i[1].lastIndex, i[0].lastIndex = i[1].lastIndex;
		}
		return r.push(t.slice(s)), r.length == 0 ? "" : r.join("");
	};
})(), Rt = /*#__PURE__*/ (function() {
	var e = {};
	return function(t, n) {
		var r = [], i = e[n];
		i || (e[n] = i = [RegExp("<" + n + "\\b[^<>]*>", "ig"), RegExp("</" + n + ">", "ig")]), i[0].lastIndex = i[1].lastIndex = 0;
		for (var a; a = i[0].exec(t);) {
			var o = a.index;
			if (i[1].lastIndex = i[0].lastIndex, a = i[1].exec(t), !a) return null;
			var s = i[1].lastIndex;
			r.push(t.slice(o, s)), i[0].lastIndex = i[1].lastIndex;
		}
		return r.length == 0 ? null : r;
	};
})();
function zt(e) {
	return e ? e.content && e.type ? ht(e.content, !0) : e.data ? m(e.data) : e.asNodeBuffer && C ? m(e.asNodeBuffer().toString("binary")) : e.asBinary ? m(e.asBinary()) : e._data && e._data.getContent ? m(ht(Array.prototype.slice.call(e._data.getContent(), 0))) : null : null;
}
function Bt(e) {
	if (!e) return null;
	if (e.data) return u(e.data);
	if (e.asNodeBuffer && C) return e.asNodeBuffer();
	if (e._data && e._data.getContent) {
		var t = e._data.getContent();
		return typeof t == "string" ? u(t) : Array.prototype.slice.call(t);
	}
	return e.content && e.type ? e.content : null;
}
function Vt(e) {
	return e && e.name.slice(-4) === ".bin" ? Bt(e) : zt(e);
}
function Ht(e, t) {
	for (var n = e.FullPaths || rt(e.files), r = t.toLowerCase().replace(/[\/]/g, "\\"), i = r.replace(/\\/g, "/"), a = 0; a < n.length; ++a) {
		var o = n[a].replace(/^Root Entry[\/]/, "").toLowerCase();
		if (r == o || i == o) return e.files ? e.files[n[a]] : e.FileIndex[a];
	}
	return null;
}
function Ut(e, t) {
	var n = Ht(e, t);
	if (n == null) throw Error("Cannot find file " + t + " in zip");
	return n;
}
function Wt(e, t, n) {
	if (!n) return Vt(Ut(e, t));
	if (!t) return null;
	try {
		return Wt(e, t);
	} catch {
		return null;
	}
}
function Gt(e, t, n) {
	if (!n) return zt(Ut(e, t));
	if (!t) return null;
	try {
		return Gt(e, t);
	} catch {
		return null;
	}
}
function Kt(e, t, n) {
	if (!n) return Bt(Ut(e, t));
	if (!t) return null;
	try {
		return Kt(e, t);
	} catch {
		return null;
	}
}
function qt(e) {
	for (var t = e.FullPaths || rt(e.files), n = [], r = 0; r < t.length; ++r) t[r].slice(-1) != "/" && n.push(t[r].replace(/^Root Entry[\/]/, ""));
	return n.sort();
}
function Jt(e, t, n) {
	if (e.FullPaths) {
		if (Array.isArray(n) && typeof n[0] == "string" && (n = n.join("")), typeof n == "string") {
			var r = C ? w(n) : ee(n);
			return et.utils.cfb_add(e, t, r);
		}
		et.utils.cfb_add(e, t, n);
	} else e.file(t, n);
}
function Yt(e, t) {
	switch (t.type) {
		case "base64": return et.read(e, { type: "base64" });
		case "binary": return et.read(e, { type: "binary" });
		case "buffer":
		case "array": return et.read(e, { type: "buffer" });
	}
	throw Error("Unrecognized type " + t.type);
}
function Xt(e, t) {
	if (e.charAt(0) == "/") return e.slice(1);
	var n = t.split("/");
	t.slice(-1) != "/" && n.pop();
	for (var r = e.split("/"); r.length !== 0;) {
		var i = r.shift();
		i === ".." ? n.pop() : i !== "." && n.push(i);
	}
	return n.join("/");
}
var Zt = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n", Qt = /\s([^"\s?>\/]+)\s*=\s*((?:")([^"]*)(?:")|(?:')([^']*)(?:')|([^'">\s]+))/g, $t = /<[\/\?]?[a-zA-Z0-9:_-]+(?:\s+[^"\s?<>\/]+\s*=\s*(?:"[^"]*"|'[^']*'|[^'"<>\s=]+))*\s*[\/\?]?>/gm, en = /*#__PURE__*/ Zt.match($t) ? $t : /<[^<>]*>/g, tn = /<\w*:/, nn = /<(\/?)\w+:/;
function K(e, t, n) {
	for (var r = {}, i = 0, a = 0; i !== e.length && !((a = e.charCodeAt(i)) === 32 || a === 10 || a === 13); ++i);
	if (t || (r[0] = e.slice(0, i)), i === e.length) return r;
	var o = e.match(Qt), s = 0, c = "", l = 0, u = "", d = "", f = 1;
	if (o) for (l = 0; l != o.length; ++l) {
		for (d = o[l].slice(1), a = 0; a != d.length && d.charCodeAt(a) !== 61; ++a);
		for (u = d.slice(0, a).trim(); d.charCodeAt(a + 1) == 32;) ++a;
		for (f = +((i = d.charCodeAt(a + 1)) == 34 || i == 39), c = d.slice(a + 1 + f, d.length - f), s = 0; s != u.length && u.charCodeAt(s) !== 58; ++s);
		if (s === u.length) u.indexOf("_") > 0 && (u = u.slice(0, u.indexOf("_"))), r[u] = c, n || (r[u.toLowerCase()] = c);
		else {
			var p = (s === 5 && u.slice(0, 5) === "xmlns" ? "xmlns" : "") + u.slice(s + 1);
			if (r[p] && u.slice(s - 3, s) == "ext") continue;
			r[p] = c, n || (r[p.toLowerCase()] = c);
		}
	}
	return r;
}
function rn(e, t, n) {
	for (var r = {}, i = 0, a = 0; i !== e.length && !((a = e.charCodeAt(i)) === 32 || a === 10 || a === 13); ++i);
	if (t || (r[0] = e.slice(0, i)), i === e.length) return r;
	var o = e.match(Qt), s = "", c = 0, l = "", u = "", d = 1;
	if (o) for (c = 0; c != o.length; ++c) {
		for (u = o[c].slice(1), a = 0; a != u.length && u.charCodeAt(a) !== 61; ++a);
		for (l = u.slice(0, a).trim(); u.charCodeAt(a + 1) == 32;) ++a;
		d = +((i = u.charCodeAt(a + 1)) == 34 || i == 39), s = u.slice(a + 1 + d, u.length - d), l.indexOf("_") > 0 && (l = l.slice(0, l.indexOf("_"))), r[l] = s, n || (r[l.toLowerCase()] = s);
	}
	return r;
}
function an(e) {
	return e.replace(nn, "<$1");
}
var on = {
	"&quot;": "\"",
	"&apos;": "'",
	"&gt;": ">",
	"&lt;": "<",
	"&amp;": "&"
}, sn = /*#__PURE__*/ it(on), q = /*#__PURE__*/ (function() {
	var e = /&(?:quot|apos|gt|lt|amp|#x?([\da-fA-F]+));/gi, t = /_x([\da-fA-F]{4})_/g;
	function n(r) {
		var i = r + "", a = i.indexOf("<![CDATA[");
		if (a == -1) return i.replace(e, function(e, t) {
			return on[e] || String.fromCharCode(parseInt(t, e.indexOf("x") > -1 ? 16 : 10)) || e;
		}).replace(t, function(e, t) {
			return String.fromCharCode(parseInt(t, 16));
		});
		var o = i.indexOf("]]>");
		return n(i.slice(0, a)) + i.slice(a + 9, o) + n(i.slice(o + 3));
	}
	return function(e, t) {
		var r = n(e);
		return t ? r.replace(/\r\n/g, "\n") : r;
	};
})(), cn = /[&<>'"]/g, ln = /[\u0000-\u0008\u000b-\u001f\uFFFE-\uFFFF]/g;
function un(e) {
	return (e + "").replace(cn, function(e) {
		return sn[e];
	}).replace(ln, function(e) {
		return "_x" + ("000" + e.charCodeAt(0).toString(16)).slice(-4) + "_";
	});
}
var dn = /[\u0000-\u001f]/g;
function fn(e) {
	return (e + "").replace(cn, function(e) {
		return sn[e];
	}).replace(/\n/g, "<br/>").replace(dn, function(e) {
		return "&#x" + ("000" + e.charCodeAt(0).toString(16)).slice(-4) + ";";
	});
}
var pn = /*#__PURE__*/ (function() {
	var e = /&#(\d+);/g;
	function t(e, t) {
		return String.fromCharCode(parseInt(t, 10));
	}
	return function(n) {
		return n.replace(e, t);
	};
})();
function J(e) {
	switch (e) {
		case 1:
		case !0:
		case "1":
		case "true": return !0;
		case 0:
		case !1:
		case "0":
		case "false": return !1;
	}
	return !1;
}
function mn(e) {
	for (var t = "", n = 0, r = 0, i = 0, a = 0, o = 0, s = 0; n < e.length;) {
		if (r = e.charCodeAt(n++), r < 128) {
			t += String.fromCharCode(r);
			continue;
		}
		if (i = e.charCodeAt(n++), r > 191 && r < 224) {
			o = (r & 31) << 6, o |= i & 63, t += String.fromCharCode(o);
			continue;
		}
		if (a = e.charCodeAt(n++), r < 240) {
			t += String.fromCharCode((r & 15) << 12 | (i & 63) << 6 | a & 63);
			continue;
		}
		o = e.charCodeAt(n++), s = ((r & 7) << 18 | (i & 63) << 12 | (a & 63) << 6 | o & 63) - 65536, t += String.fromCharCode(55296 + (s >>> 10 & 1023)), t += String.fromCharCode(56320 + (s & 1023));
	}
	return t;
}
function hn(e) {
	var t = E(2 * e.length), n, r, i = 1, a = 0, o = 0, s;
	for (r = 0; r < e.length; r += i) i = 1, (s = e.charCodeAt(r)) < 128 ? n = s : s < 224 ? (n = (s & 31) * 64 + (e.charCodeAt(r + 1) & 63), i = 2) : s < 240 ? (n = (s & 15) * 4096 + (e.charCodeAt(r + 1) & 63) * 64 + (e.charCodeAt(r + 2) & 63), i = 3) : (i = 4, n = (s & 7) * 262144 + (e.charCodeAt(r + 1) & 63) * 4096 + (e.charCodeAt(r + 2) & 63) * 64 + (e.charCodeAt(r + 3) & 63), n -= 65536, o = 55296 + (n >>> 10 & 1023), n = 56320 + (n & 1023)), o !== 0 && (t[a++] = o & 255, t[a++] = o >>> 8, o = 0), t[a++] = n % 256, t[a++] = n >>> 8;
	return t.slice(0, a).toString("ucs2");
}
function gn(e) {
	return w(e, "binary").toString("utf8");
}
var _n = "foo bar bazâð£", vn = /*#__PURE__*/ (function() {
	if (C) {
		if (gn(_n) == mn(_n)) return gn;
		if (hn(_n) == mn(_n)) return hn;
	}
	return mn;
})(), yn = C ? function(e) {
	return w(e, "utf8").toString("binary");
} : function(e) {
	for (var t = [], n = 0, r = 0, i = 0; n < e.length;) switch (r = e.charCodeAt(n++), !0) {
		case r < 128:
			t.push(String.fromCharCode(r));
			break;
		case r < 2048:
			t.push(String.fromCharCode(192 + (r >> 6))), t.push(String.fromCharCode(128 + (r & 63)));
			break;
		case r >= 55296 && r < 57344:
			r -= 55296, i = e.charCodeAt(n++) - 56320 + (r << 10), t.push(String.fromCharCode(240 + (i >> 18 & 7))), t.push(String.fromCharCode(144 + (i >> 12 & 63))), t.push(String.fromCharCode(128 + (i >> 6 & 63))), t.push(String.fromCharCode(128 + (i & 63)));
			break;
		default: t.push(String.fromCharCode(224 + (r >> 12))), t.push(String.fromCharCode(128 + (r >> 6 & 63))), t.push(String.fromCharCode(128 + (r & 63)));
	}
	return t.join("");
}, bn = /*#__PURE__*/ (function() {
	var e = [
		["nbsp", " "],
		["middot", "·"],
		["quot", "\""],
		["apos", "'"],
		["gt", ">"],
		["lt", "<"],
		["amp", "&"]
	].map(function(e) {
		return [RegExp("&" + e[0] + ";", "ig"), e[1]];
	});
	return function(t) {
		for (var n = t.replace(/^[\t\n\r ]+/, "").replace(/(^|[^\t\n\r ])[\t\n\r ]+$/, "$1").replace(/>\s+/g, ">").replace(/\b\s+</g, "<").replace(/[\t\n\r ]+/g, " ").replace(/<\s*[bB][rR]\s*\/?>/g, "\n").replace(/<[^<>]*>/g, ""), r = 0; r < e.length; ++r) n = n.replace(e[r][0], e[r][1]);
		return n;
	};
})(), xn = /<\/?(?:vt:)?variant>/g, Sn = /<(?:vt:)([^<"'>]*)>([\s\S]*)</;
function Cn(e, t) {
	var n = K(e), r = It(e, n.baseType) || [], i = [];
	if (r.length != n.size) {
		if (t.WTF) throw Error("unexpected vector length " + r.length + " != " + n.size);
		return i;
	}
	return r.forEach(function(e) {
		var t = e.replace(xn, "").match(Sn);
		t && i.push({
			v: vn(t[2]),
			t: t[1]
		});
	}), i;
}
var wn = /(^\s|\s$|\n)/;
function Tn(e) {
	return rt(e).map(function(t) {
		return " " + t + "=\"" + e[t] + "\"";
	}).join("");
}
function En(e, t, n) {
	return "<" + e + (n == null ? "" : Tn(n)) + (t == null ? "/" : (t.match(wn) ? " xml:space=\"preserve\"" : "") + ">" + t + "</" + e) + ">";
}
function Dn(e) {
	if (C && Buffer.isBuffer(e)) return e.toString("utf8");
	if (typeof e == "string") return e;
	if (typeof Uint8Array < "u" && e instanceof Uint8Array) return vn(k(A(e)));
	throw Error("Bad input format: expected Buffer or string");
}
var On = /<([\/]?)([^\s?><!\/:"]*:|)([^\s?<>:\/"]+)(?:\s+[^<>=?"'\s]+="[^"]*?")*\s*[\/]?>/gm, kn = {
	CORE_PROPS: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
	CUST_PROPS: "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties",
	EXT_PROPS: "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
	CT: "http://schemas.openxmlformats.org/package/2006/content-types",
	RELS: "http://schemas.openxmlformats.org/package/2006/relationships",
	TCMNT: "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments",
	dc: "http://purl.org/dc/elements/1.1/",
	dcterms: "http://purl.org/dc/terms/",
	dcmitype: "http://purl.org/dc/dcmitype/",
	mx: "http://schemas.microsoft.com/office/mac/excel/2008/main",
	r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
	sjs: "http://schemas.openxmlformats.org/package/2006/sheetjs/core-properties",
	vt: "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
	xsi: "http://www.w3.org/2001/XMLSchema-instance",
	xsd: "http://www.w3.org/2001/XMLSchema"
}, An = [
	"http://schemas.openxmlformats.org/spreadsheetml/2006/main",
	"http://purl.oclc.org/ooxml/spreadsheetml/main",
	"http://schemas.microsoft.com/office/excel/2006/main",
	"http://schemas.microsoft.com/office/excel/2006/2"
];
function jn(e, t) {
	for (var n = 1 - 2 * (e[t + 7] >>> 7), r = ((e[t + 7] & 127) << 4) + (e[t + 6] >>> 4 & 15), i = e[t + 6] & 15, a = 5; a >= 0; --a) i = i * 256 + e[t + a];
	return r == 2047 ? i == 0 ? n * Infinity : NaN : (r == 0 ? r = -1022 : (r -= 1023, i += 2 ** 52), n * 2 ** (r - 52) * i);
}
function Mn(e, t, n) {
	var r = (t < 0 || 1 / t == -Infinity) << 7, i = 0, a = 0, o = r ? -t : t;
	isFinite(o) ? o == 0 ? i = a = 0 : (i = Math.floor(Math.log(o) / Math.LN2), a = o * 2 ** (52 - i), i <= -1023 && (!isFinite(a) || a < 2 ** 52) ? i = -1022 : (a -= 2 ** 52, i += 1023)) : (i = 2047, a = isNaN(t) ? 26985 : 0);
	for (var s = 0; s <= 5; ++s, a /= 256) e[n + s] = a & 255;
	e[n + 6] = (i & 15) << 4 | a & 15, e[n + 7] = i >> 4 | r;
}
var Nn = function(e) {
	for (var t = [], n = 10240, r = 0; r < e[0].length; ++r) if (e[0][r]) for (var i = 0, a = e[0][r].length; i < a; i += n) t.push.apply(t, e[0][r].slice(i, i + n));
	return t;
}, Pn = C ? function(e) {
	return e[0].length > 0 && Buffer.isBuffer(e[0][0]) ? Buffer.concat(e[0].map(function(e) {
		return Buffer.isBuffer(e) ? e : w(e);
	})) : Nn(e);
} : Nn, Fn = function(e, t, n) {
	for (var r = [], i = t; i < n; i += 2) r.push(String.fromCharCode(nr(e, i)));
	return r.join("").replace(M, "");
}, In = C ? function(e, t, n) {
	return !Buffer.isBuffer(e) || !T ? Fn(e, t, n) : e.toString("utf16le", t, n).replace(M, "");
} : Fn, Ln = function(e, t, n) {
	for (var r = [], i = t; i < t + n; ++i) r.push(("0" + e[i].toString(16)).slice(-2));
	return r.join("");
}, Rn = C ? function(e, t, n) {
	return Buffer.isBuffer(e) ? e.toString("hex", t, t + n) : Ln(e, t, n);
} : Ln, zn = function(e, t, n) {
	for (var r = [], i = t; i < n; i++) r.push(String.fromCharCode(tr(e, i)));
	return r.join("");
}, Bn = C ? function(e, t, n) {
	return Buffer.isBuffer(e) ? e.toString("utf8", t, n) : zn(e, t, n);
} : zn, Vn = function(e, t) {
	var n = ir(e, t);
	return n > 0 ? Bn(e, t + 4, t + 4 + n - 1) : "";
}, Hn = Vn, Un = function(e, t) {
	var n = ir(e, t);
	return n > 0 ? Bn(e, t + 4, t + 4 + n - 1) : "";
}, Wn = Un, Gn = function(e, t) {
	var n = 2 * ir(e, t);
	return n > 0 ? Bn(e, t + 4, t + 4 + n - 1) : "";
}, Kn = Gn, qn = function(e, t) {
	var n = ir(e, t);
	return n > 0 ? In(e, t + 4, t + 4 + n) : "";
}, Jn = qn, Yn = function(e, t) {
	var n = ir(e, t);
	return n > 0 ? Bn(e, t + 4, t + 4 + n) : "";
}, Xn = Yn, Zn = function(e, t) {
	return jn(e, t);
}, Qn = Zn, $n = function(e) {
	return Array.isArray(e) || typeof Uint8Array < "u" && e instanceof Uint8Array;
};
C && (Hn = function(e, t) {
	if (!Buffer.isBuffer(e)) return Vn(e, t);
	var n = e.readUInt32LE(t);
	return n > 0 ? e.toString("utf8", t + 4, t + 4 + n - 1) : "";
}, Wn = function(e, t) {
	if (!Buffer.isBuffer(e)) return Un(e, t);
	var n = e.readUInt32LE(t);
	return n > 0 ? e.toString("utf8", t + 4, t + 4 + n - 1) : "";
}, Kn = function(e, t) {
	if (!Buffer.isBuffer(e) || !T) return Gn(e, t);
	var n = 2 * e.readUInt32LE(t);
	return e.toString("utf16le", t + 4, t + 4 + n - 1);
}, Jn = function(e, t) {
	if (!Buffer.isBuffer(e) || !T) return qn(e, t);
	var n = e.readUInt32LE(t);
	return e.toString("utf16le", t + 4, t + 4 + n);
}, Xn = function(e, t) {
	if (!Buffer.isBuffer(e)) return Yn(e, t);
	var n = e.readUInt32LE(t);
	return e.toString("utf8", t + 4, t + 4 + n);
}, Qn = function(e, t) {
	return Buffer.isBuffer(e) ? e.readDoubleLE(t) : Zn(e, t);
}, $n = function(e) {
	return Buffer.isBuffer(e) || Array.isArray(e) || typeof Uint8Array < "u" && e instanceof Uint8Array;
});
function er() {
	In = function(e, t, n) {
		return r.utils.decode(1200, e.slice(t, n)).replace(M, "");
	}, Bn = function(e, t, n) {
		return r.utils.decode(65001, e.slice(t, n));
	}, Hn = function(e, t) {
		var i = ir(e, t);
		return i > 0 ? r.utils.decode(n, e.slice(t + 4, t + 4 + i - 1)) : "";
	}, Wn = function(e, n) {
		var i = ir(e, n);
		return i > 0 ? r.utils.decode(t, e.slice(n + 4, n + 4 + i - 1)) : "";
	}, Kn = function(e, t) {
		var n = 2 * ir(e, t);
		return n > 0 ? r.utils.decode(1200, e.slice(t + 4, t + 4 + n - 1)) : "";
	}, Jn = function(e, t) {
		var n = ir(e, t);
		return n > 0 ? r.utils.decode(1200, e.slice(t + 4, t + 4 + n)) : "";
	}, Xn = function(e, t) {
		var n = ir(e, t);
		return n > 0 ? r.utils.decode(65001, e.slice(t + 4, t + 4 + n)) : "";
	};
}
r !== void 0 && er();
var tr = function(e, t) {
	return e[t];
}, nr = function(e, t) {
	return e[t + 1] * 256 + e[t];
}, rr = function(e, t) {
	var n = e[t + 1] * 256 + e[t];
	return n < 32768 ? n : (65535 - n + 1) * -1;
}, ir = function(e, t) {
	return e[t + 3] * (1 << 24) + (e[t + 2] << 16) + (e[t + 1] << 8) + e[t];
}, ar = function(e, t) {
	return e[t + 3] << 24 | e[t + 2] << 16 | e[t + 1] << 8 | e[t];
}, or = function(e, t) {
	return e[t] << 24 | e[t + 1] << 16 | e[t + 2] << 8 | e[t + 3];
};
function sr(e, n) {
	var i = "", a, o, s = [], c, l, u, d;
	switch (n) {
		case "dbcs":
			if (d = this.l, C && Buffer.isBuffer(this) && T) i = this.slice(this.l, this.l + 2 * e).toString("utf16le");
			else for (u = 0; u < e; ++u) i += String.fromCharCode(nr(this, d)), d += 2;
			e *= 2;
			break;
		case "utf8":
			i = Bn(this, this.l, this.l + e);
			break;
		case "utf16le":
			e *= 2, i = In(this, this.l, this.l + e);
			break;
		case "wstr":
			if (r !== void 0) i = r.utils.decode(t, this.slice(this.l, this.l + 2 * e));
			else return sr.call(this, e, "dbcs");
			e = 2 * e;
			break;
		case "lpstr-ansi":
			i = Hn(this, this.l), e = 4 + ir(this, this.l);
			break;
		case "lpstr-cp":
			i = Wn(this, this.l), e = 4 + ir(this, this.l);
			break;
		case "lpwstr":
			i = Kn(this, this.l), e = 4 + 2 * ir(this, this.l);
			break;
		case "lpp4":
			e = 4 + ir(this, this.l), i = Jn(this, this.l), e & 2 && (e += 2);
			break;
		case "8lpp4":
			e = 4 + ir(this, this.l), i = Xn(this, this.l), e & 3 && (e += 4 - (e & 3));
			break;
		case "cstr":
			for (e = 0, i = ""; (c = tr(this, this.l + e++)) !== 0;) s.push(h(c));
			i = s.join("");
			break;
		case "_wstr":
			for (e = 0, i = ""; (c = nr(this, this.l + e)) !== 0;) s.push(h(c)), e += 2;
			e += 2, i = s.join("");
			break;
		case "dbcs-cont":
			for (i = "", d = this.l, u = 0; u < e; ++u) {
				if (this.lens && this.lens.indexOf(d) !== -1) return c = tr(this, d), this.l = d + 1, l = sr.call(this, e - u, c ? "dbcs-cont" : "sbcs-cont"), s.join("") + l;
				s.push(h(nr(this, d))), d += 2;
			}
			i = s.join(""), e *= 2;
			break;
		case "cpstr": if (r !== void 0) {
			i = r.utils.decode(t, this.slice(this.l, this.l + e));
			break;
		}
		case "sbcs-cont":
			for (i = "", d = this.l, u = 0; u != e; ++u) {
				if (this.lens && this.lens.indexOf(d) !== -1) return c = tr(this, d), this.l = d + 1, l = sr.call(this, e - u, c ? "dbcs-cont" : "sbcs-cont"), s.join("") + l;
				s.push(h(tr(this, d))), d += 1;
			}
			i = s.join("");
			break;
		default: switch (e) {
			case 1: return a = tr(this, this.l), this.l++, a;
			case 2: return a = (n === "i" ? rr : nr)(this, this.l), this.l += 2, a;
			case 4:
			case -4: return n === "i" || !(this[this.l + 3] & 128) ? (a = (e > 0 ? ar : or)(this, this.l), this.l += 4, a) : (o = ir(this, this.l), this.l += 4, o);
			case 8:
			case -8:
				if (n === "f") return o = e == 8 ? Qn(this, this.l) : Qn([
					this[this.l + 7],
					this[this.l + 6],
					this[this.l + 5],
					this[this.l + 4],
					this[this.l + 3],
					this[this.l + 2],
					this[this.l + 1],
					this[this.l + 0]
				], 0), this.l += 8, o;
				e = 8;
			case 16:
				i = Rn(this, this.l, e);
				break;
		}
	}
	return this.l += e, i;
}
var cr = function(e, t, n) {
	e[n] = t & 255, e[n + 1] = t >>> 8 & 255, e[n + 2] = t >>> 16 & 255, e[n + 3] = t >>> 24 & 255;
}, lr = function(e, t, n) {
	e[n] = t & 255, e[n + 1] = t >> 8 & 255, e[n + 2] = t >> 16 & 255, e[n + 3] = t >> 24 & 255;
}, ur = function(e, t, n) {
	e[n] = t & 255, e[n + 1] = t >>> 8 & 255;
};
function dr(e, i, a) {
	var o = 0, s = 0;
	if (a === "dbcs") {
		for (s = 0; s != i.length; ++s) ur(this, i.charCodeAt(s), this.l + 2 * s);
		o = 2 * i.length;
	} else if (a === "sbcs" || a == "cpstr") if (r !== void 0 && n == 874) {
		for (s = 0; s != i.length; ++s) {
			var c = r.utils.encode(n, i.charAt(s));
			this[this.l + s] = c[0];
		}
		o = i.length;
	} else if (r !== void 0 && a == "cpstr") {
		if (c = r.utils.encode(t, i), c.length == i.length) for (s = 0; s < i.length; ++s) c[s] == 0 && i.charCodeAt(s) != 0 && (c[s] = 95);
		if (c.length == 2 * i.length) for (s = 0; s < i.length; ++s) c[2 * s] == 0 && c[2 * s + 1] == 0 && i.charCodeAt(s) != 0 && (c[2 * s] = 95);
		for (s = 0; s < c.length; ++s) this[this.l + s] = c[s];
		o = c.length;
	} else {
		for (i = i.replace(/[^\x00-\x7F]/g, "_"), s = 0; s != i.length; ++s) this[this.l + s] = i.charCodeAt(s) & 255;
		o = i.length;
	}
	else if (a === "hex") {
		for (; s < e; ++s) this[this.l++] = parseInt(i.slice(2 * s, 2 * s + 2), 16) || 0;
		return this;
	} else if (a === "utf16le") {
		var l = Math.min(this.l + e, this.length);
		for (s = 0; s < Math.min(i.length, e); ++s) {
			var u = i.charCodeAt(s);
			this[this.l++] = u & 255, this[this.l++] = u >> 8;
		}
		for (; this.l < l;) this[this.l++] = 0;
		return this;
	} else switch (e) {
		case 1:
			o = 1, this[this.l] = i & 255;
			break;
		case 2:
			o = 2, this[this.l] = i & 255, i >>>= 8, this[this.l + 1] = i & 255;
			break;
		case 3:
			o = 3, this[this.l] = i & 255, i >>>= 8, this[this.l + 1] = i & 255, i >>>= 8, this[this.l + 2] = i & 255;
			break;
		case 4:
			o = 4, cr(this, i, this.l);
			break;
		case 8: if (o = 8, a === "f") {
			Mn(this, i, this.l);
			break;
		}
		case 16: break;
		case -4:
			o = 4, lr(this, i, this.l);
			break;
	}
	return this.l += o, this;
}
function fr(e, t) {
	var n = Rn(this, this.l, e.length >> 1);
	if (n !== e) throw Error(t + "Expected " + e + " saw " + n);
	this.l += e.length >> 1;
}
function pr(e, t) {
	e.l = t, e.read_shift = sr, e.chk = fr, e.write_shift = dr;
}
function mr(e, t) {
	e.l += t;
}
function hr(e) {
	var t = E(e);
	return pr(t, 0), t;
}
function gr(e, t, n) {
	if (e) {
		var r, i, a;
		pr(e, e.l || 0);
		for (var o = e.length, s = 0, c = 0; e.l < o;) {
			s = e.read_shift(1), s & 128 && (s = (s & 127) + ((e.read_shift(1) & 127) << 7));
			var l = jm[s] || jm[65535];
			for (r = e.read_shift(1), a = r & 127, i = 1; i < 4 && r & 128; ++i) a += ((r = e.read_shift(1)) & 127) << 7 * i;
			c = e.l + a;
			var u = l.f && l.f(e, a, n);
			if (e.l = c, t(u, l, s)) return;
		}
	}
}
function _r() {
	var e = [], t = C ? 16384 : 2048, n = C && typeof hr(t).subarray == "function", r = function(e) {
		var t = hr(e);
		return pr(t, 0), t;
	}, i = r(t), a = function() {
		i && (i.l && (i.length > i.l && (i = i.slice(0, i.l), i.l = i.length), i.length > 0 && e.push(i)), i = null);
	};
	return {
		next: function(e) {
			return i && e < i.length - i.l ? i : (a(), i = r(Math.max(e + 1, t)));
		},
		push: function(t) {
			i.l > 0 && e.push(i.slice(0, i.l)), e.push(t), i = n ? i.subarray(i.l || 0) : i.slice(i.l || 0), pr(i, 0);
		},
		end: function() {
			return a(), j(e);
		},
		_bufs: e,
		end2: function() {
			return a(), e;
		}
	};
}
function vr(e, t, n) {
	var r = gt(e);
	if (t.s ? (r.cRel && (r.c += t.s.c), r.rRel && (r.r += t.s.r)) : (r.cRel && (r.c += t.c), r.rRel && (r.r += t.r)), !n || n.biff < 12) {
		for (; r.c >= 256;) r.c -= 256;
		for (; r.r >= 65536;) r.r -= 65536;
	}
	return r;
}
function yr(e, t, n) {
	var r = gt(e);
	return r.s = vr(r.s, t.s, n), r.e = vr(r.e, t.s, n), r;
}
function br(e, t) {
	if (e.cRel && e.c < 0) for (e = gt(e); e.c < 0;) e.c += t > 8 ? 16384 : 256;
	if (e.rRel && e.r < 0) for (e = gt(e); e.r < 0;) e.r += t > 8 ? 1048576 : t > 5 ? 65536 : 16384;
	var n = Y(e);
	return !e.cRel && e.cRel != null && (n = Or(n)), !e.rRel && e.rRel != null && (n = wr(n)), n;
}
function xr(e, t) {
	return e.s.r == 0 && !e.s.rRel && e.e.r == (t.biff >= 12 ? 1048575 : t.biff >= 8 ? 65536 : 16384) && !e.e.rRel ? (e.s.cRel ? "" : "$") + Dr(e.s.c) + ":" + (e.e.cRel ? "" : "$") + Dr(e.e.c) : e.s.c == 0 && !e.s.cRel && e.e.c == (t.biff >= 12 ? 16383 : 255) && !e.e.cRel ? (e.s.rRel ? "" : "$") + Cr(e.s.r) + ":" + (e.e.rRel ? "" : "$") + Cr(e.e.r) : br(e.s, t.biff) + ":" + br(e.e, t.biff);
}
function Sr(e) {
	return parseInt(Tr(e), 10) - 1;
}
function Cr(e) {
	return "" + (e + 1);
}
function wr(e) {
	return e.replace(/([A-Z]|^)(\d+)$/, "$1$$$2");
}
function Tr(e) {
	return e.replace(/\$(\d+)$/, "$1");
}
function Er(e) {
	for (var t = kr(e), n = 0, r = 0; r !== t.length; ++r) n = 26 * n + t.charCodeAt(r) - 64;
	return n - 1;
}
function Dr(e) {
	if (e < 0) throw Error("invalid column " + e);
	var t = "";
	for (++e; e; e = Math.floor((e - 1) / 26)) t = String.fromCharCode((e - 1) % 26 + 65) + t;
	return t;
}
function Or(e) {
	return e.replace(/^([A-Z])/, "$$$1");
}
function kr(e) {
	return e.replace(/^\$([A-Z])/, "$1");
}
function Ar(e) {
	return e.replace(/(\$?[A-Z]*)(\$?\d*)/, "$1,$2").split(",");
}
function jr(e) {
	for (var t = 0, n = 0, r = 0; r < e.length; ++r) {
		var i = e.charCodeAt(r);
		i >= 48 && i <= 57 ? t = 10 * t + (i - 48) : i >= 65 && i <= 90 && (n = 26 * n + (i - 64));
	}
	return {
		c: n - 1,
		r: t - 1
	};
}
function Y(e) {
	for (var t = e.c + 1, n = ""; t; t = (t - 1) / 26 | 0) n = String.fromCharCode((t - 1) % 26 + 65) + n;
	return n + (e.r + 1);
}
function Mr(e) {
	var t = e.indexOf(":");
	return t == -1 ? {
		s: jr(e),
		e: jr(e)
	} : {
		s: jr(e.slice(0, t)),
		e: jr(e.slice(t + 1))
	};
}
function X(e, t) {
	return t === void 0 || typeof t == "number" ? X(e.s, e.e) : (typeof e != "string" && (e = Y(e)), typeof t != "string" && (t = Y(t)), e == t ? e : e + ":" + t);
}
function Nr(e, t) {
	if (!e && !(t && t.biff <= 5 && t.biff >= 2)) throw Error("empty sheet name");
	return /[^\w\u4E00-\u9FFF\u3040-\u30FF]/.test(e) ? "'" + e.replace(/'/g, "''") + "'" : e;
}
function Pr(e) {
	var t = {
		s: {
			c: 0,
			r: 0
		},
		e: {
			c: 0,
			r: 0
		}
	}, n = 0, r = 0, i = 0, a = e.length;
	for (n = 0; r < a && !((i = e.charCodeAt(r) - 64) < 1 || i > 26); ++r) n = 26 * n + i;
	for (t.s.c = --n, n = 0; r < a && !((i = e.charCodeAt(r) - 48) < 0 || i > 9); ++r) n = 10 * n + i;
	if (t.s.r = --n, r === a || i != 10) return t.e.c = t.s.c, t.e.r = t.s.r, t;
	for (++r, n = 0; r != a && !((i = e.charCodeAt(r) - 64) < 1 || i > 26); ++r) n = 26 * n + i;
	for (t.e.c = --n, n = 0; r != a && !((i = e.charCodeAt(r) - 48) < 0 || i > 9); ++r) n = 10 * n + i;
	return t.e.r = --n, t;
}
function Fr(e, t) {
	var n = e.t == "d" && t instanceof Date;
	if (e.z != null) try {
		return e.w = We(e.z, n ? ct(t) : t);
	} catch {}
	try {
		return e.w = We((e.XF || {}).numFmtId || (n ? 14 : 0), n ? ct(t) : t);
	} catch {
		return "" + t;
	}
}
function Ir(e, t, n) {
	return e == null || e.t == null || e.t == "z" ? "" : e.w === void 0 ? (e.t == "d" && !e.z && n && n.dateNF && (e.z = n.dateNF), e.t == "e" ? Ei[e.v] || e.v : t == null ? Fr(e, e.v) : Fr(e, t)) : e.w;
}
function Lr(e, t) {
	var n = t && t.sheet ? t.sheet : "Sheet1", r = {};
	return r[n] = e, {
		SheetNames: [n],
		Sheets: r
	};
}
function Rr(e) {
	var t = {};
	return (e || {}).dense && (t["!data"] = []), t;
}
function zr(e, t, n) {
	var r = n || {}, i = e ? e["!data"] != null : r.dense;
	_ != null && i == null && (i = _);
	var a = e || (i ? { "!data": [] } : {});
	i && !a["!data"] && (a["!data"] = []);
	var o = 0, s = 0;
	if (a && r.origin != null) if (typeof r.origin == "number") o = r.origin;
	else {
		var c = typeof r.origin == "string" ? jr(r.origin) : r.origin;
		o = c.r, s = c.c;
	}
	var l = {
		s: {
			c: 1e7,
			r: 1e7
		},
		e: {
			c: 0,
			r: 0
		}
	};
	if (a["!ref"]) {
		var u = Pr(a["!ref"]);
		l.s.c = u.s.c, l.s.r = u.s.r, l.e.c = Math.max(l.e.c, u.e.c), l.e.r = Math.max(l.e.r, u.e.r), o == -1 && (l.e.r = o = a["!ref"] ? u.e.r + 1 : 0);
	} else l.s.c = l.e.c = l.s.r = l.e.r = 0;
	for (var d = [], f = !1, p = 0; p != t.length; ++p) if (t[p]) {
		if (!Array.isArray(t[p])) throw Error("aoa_to_sheet expects an array of arrays");
		var m = o + p;
		i && (a["!data"][m] || (a["!data"][m] = []), d = a["!data"][m]);
		for (var h = t[p], g = 0; g != h.length; ++g) if (h[g] !== void 0) {
			var v = {
				v: h[g],
				t: ""
			}, y = s + g;
			if (l.s.r > m && (l.s.r = m), l.s.c > y && (l.s.c = y), l.e.r < m && (l.e.r = m), l.e.c < y && (l.e.c = y), f = !0, h[g] && typeof h[g] == "object" && !Array.isArray(h[g]) && !(h[g] instanceof Date)) v = h[g];
			else if (Array.isArray(v.v) && (v.f = h[g][1], v.v = v.v[0]), v.v === null) if (v.f) v.t = "n";
			else if (r.nullError) v.t = "e", v.v = 0;
			else if (r.sheetStubs) v.t = "z";
			else continue;
			else typeof v.v == "number" ? isFinite(v.v) ? v.t = "n" : isNaN(v.v) ? (v.t = "e", v.v = 15) : (v.t = "e", v.v = 7) : typeof v.v == "boolean" ? v.t = "b" : v.v instanceof Date ? (v.z = r.dateNF || V[14], r.UTC || (v.v = kt(v.v)), r.cellDates ? (v.t = "d", v.w = We(v.z, ct(v.v, r.date1904))) : (v.t = "n", v.v = ct(v.v, r.date1904), v.w = We(v.z, v.v))) : v.t = "s";
			if (i) d[y] && d[y].z && (v.z = d[y].z), d[y] = v;
			else {
				var b = Dr(y) + (m + 1);
				a[b] && a[b].z && (v.z = a[b].z), a[b] = v;
			}
		}
	}
	return f && l.s.c < 104e5 && (a["!ref"] = X(l)), a;
}
function Br(e, t) {
	return zr(null, e, t);
}
function Vr(e) {
	return e.read_shift(4, "i");
}
function Hr(e) {
	var t = e.read_shift(4);
	return t === 0 ? "" : e.read_shift(t, "dbcs");
}
function Ur(e) {
	return {
		ich: e.read_shift(2),
		ifnt: e.read_shift(2)
	};
}
function Wr(e, t) {
	var n = e.l, r = e.read_shift(1), i = Hr(e), a = [], o = {
		t: i,
		h: i
	};
	if (r & 1) {
		for (var s = e.read_shift(4), c = 0; c != s; ++c) a.push(Ur(e));
		o.r = a;
	} else o.r = [{
		ich: 0,
		ifnt: 0
	}];
	return e.l = n + t, o;
}
var Gr = Wr;
function Kr(e) {
	var t = e.read_shift(4), n = e.read_shift(2);
	return n += e.read_shift(1) << 16, e.l++, {
		c: t,
		iStyleRef: n
	};
}
function qr(e) {
	var t = e.read_shift(2);
	return t += e.read_shift(1) << 16, e.l++, {
		c: -1,
		iStyleRef: t
	};
}
var Jr = Hr;
function Yr(e) {
	var t = e.read_shift(4);
	return t === 0 || t === 4294967295 ? "" : e.read_shift(t, "dbcs");
}
var Xr = Hr, Zr = Yr;
function Qr(e) {
	var t = e.slice(e.l, e.l + 4), n = t[0] & 1, r = t[0] & 2;
	e.l += 4;
	var i = r === 0 ? Qn([
		0,
		0,
		0,
		0,
		t[0] & 252,
		t[1],
		t[2],
		t[3]
	], 0) : ar(t, 0) >> 2;
	return n ? i / 100 : i;
}
function $r(e) {
	var t = {
		s: {},
		e: {}
	};
	return t.s.r = e.read_shift(4), t.e.r = e.read_shift(4), t.s.c = e.read_shift(4), t.e.c = e.read_shift(4), t;
}
var ei = $r;
function ti(e) {
	if (e.length - e.l < 8) throw "XLS Xnum Buffer underflow";
	return e.read_shift(8, "f");
}
function ni(e) {
	var t = {}, n = e.read_shift(1) >>> 1, r = e.read_shift(1), i = e.read_shift(2, "i"), a = e.read_shift(1), o = e.read_shift(1), s = e.read_shift(1);
	switch (e.l++, n) {
		case 0:
			t.auto = 1;
			break;
		case 1:
			t.index = r;
			var c = Ti[r];
			c && (t.rgb = Qs(c));
			break;
		case 2:
			t.rgb = Qs([
				a,
				o,
				s
			]);
			break;
		case 3:
			t.theme = r;
			break;
	}
	return i != 0 && (t.tint = i > 0 ? i / 32767 : i / 32768), t;
}
function ri(e) {
	var t = e.read_shift(1);
	return e.l++, {
		fBold: t & 1,
		fItalic: t & 2,
		fUnderline: t & 4,
		fStrikeout: t & 8,
		fOutline: t & 16,
		fShadow: t & 32,
		fCondense: t & 64,
		fExtend: t & 128
	};
}
function ii(e, t) {
	var n = {
		2: "BITMAP",
		3: "METAFILEPICT",
		8: "DIB",
		14: "ENHMETAFILE"
	}, r = e.read_shift(4);
	switch (r) {
		case 0: return "";
		case 4294967295:
		case 4294967294: return n[e.read_shift(4)] || "";
	}
	if (r > 400) throw Error("Unsupported Clipboard: " + r.toString(16));
	return e.l -= 4, e.read_shift(0, t == 1 ? "lpstr" : "lpwstr");
}
function ai(e) {
	return ii(e, 1);
}
function oi(e) {
	return ii(e, 2);
}
var si = 2, ci = 3, li = 11, ui = 12, di = 19, fi = 64, pi = 65, mi = 71, hi = 4108, gi = 4126, _i = 80, vi = 81, yi = [_i, vi], bi = {
	1: {
		n: "CodePage",
		t: si
	},
	2: {
		n: "Category",
		t: _i
	},
	3: {
		n: "PresentationFormat",
		t: _i
	},
	4: {
		n: "ByteCount",
		t: ci
	},
	5: {
		n: "LineCount",
		t: ci
	},
	6: {
		n: "ParagraphCount",
		t: ci
	},
	7: {
		n: "SlideCount",
		t: ci
	},
	8: {
		n: "NoteCount",
		t: ci
	},
	9: {
		n: "HiddenCount",
		t: ci
	},
	10: {
		n: "MultimediaClipCount",
		t: ci
	},
	11: {
		n: "ScaleCrop",
		t: li
	},
	12: {
		n: "HeadingPairs",
		t: hi
	},
	13: {
		n: "TitlesOfParts",
		t: gi
	},
	14: {
		n: "Manager",
		t: _i
	},
	15: {
		n: "Company",
		t: _i
	},
	16: {
		n: "LinksUpToDate",
		t: li
	},
	17: {
		n: "CharacterCount",
		t: ci
	},
	19: {
		n: "SharedDoc",
		t: li
	},
	22: {
		n: "HyperlinksChanged",
		t: li
	},
	23: {
		n: "AppVersion",
		t: ci,
		p: "version"
	},
	24: {
		n: "DigSig",
		t: pi
	},
	26: {
		n: "ContentType",
		t: _i
	},
	27: {
		n: "ContentStatus",
		t: _i
	},
	28: {
		n: "Language",
		t: _i
	},
	29: {
		n: "Version",
		t: _i
	},
	255: {},
	2147483648: {
		n: "Locale",
		t: di
	},
	2147483651: {
		n: "Behavior",
		t: di
	},
	1919054434: {}
}, xi = {
	1: {
		n: "CodePage",
		t: si
	},
	2: {
		n: "Title",
		t: _i
	},
	3: {
		n: "Subject",
		t: _i
	},
	4: {
		n: "Author",
		t: _i
	},
	5: {
		n: "Keywords",
		t: _i
	},
	6: {
		n: "Comments",
		t: _i
	},
	7: {
		n: "Template",
		t: _i
	},
	8: {
		n: "LastAuthor",
		t: _i
	},
	9: {
		n: "RevNumber",
		t: _i
	},
	10: {
		n: "EditTime",
		t: fi
	},
	11: {
		n: "LastPrinted",
		t: fi
	},
	12: {
		n: "CreatedDate",
		t: fi
	},
	13: {
		n: "ModifiedDate",
		t: fi
	},
	14: {
		n: "PageCount",
		t: ci
	},
	15: {
		n: "WordCount",
		t: ci
	},
	16: {
		n: "CharCount",
		t: ci
	},
	17: {
		n: "Thumbnail",
		t: mi
	},
	18: {
		n: "Application",
		t: _i
	},
	19: {
		n: "DocSecurity",
		t: ci
	},
	255: {},
	2147483648: {
		n: "Locale",
		t: di
	},
	2147483651: {
		n: "Behavior",
		t: di
	},
	1919054434: {}
}, Si = {
	1: "US",
	2: "CA",
	3: "",
	7: "RU",
	20: "EG",
	30: "GR",
	31: "NL",
	32: "BE",
	33: "FR",
	34: "ES",
	36: "HU",
	39: "IT",
	41: "CH",
	43: "AT",
	44: "GB",
	45: "DK",
	46: "SE",
	47: "NO",
	48: "PL",
	49: "DE",
	52: "MX",
	55: "BR",
	61: "AU",
	64: "NZ",
	66: "TH",
	81: "JP",
	82: "KR",
	84: "VN",
	86: "CN",
	90: "TR",
	105: "JS",
	213: "DZ",
	216: "MA",
	218: "LY",
	351: "PT",
	354: "IS",
	358: "FI",
	420: "CZ",
	886: "TW",
	961: "LB",
	962: "JO",
	963: "SY",
	964: "IQ",
	965: "KW",
	966: "SA",
	971: "AE",
	972: "IL",
	974: "QA",
	981: "IR",
	65535: "US"
}, Ci = [
	null,
	"solid",
	"mediumGray",
	"darkGray",
	"lightGray",
	"darkHorizontal",
	"darkVertical",
	"darkDown",
	"darkUp",
	"darkGrid",
	"darkTrellis",
	"lightHorizontal",
	"lightVertical",
	"lightDown",
	"lightUp",
	"lightGrid",
	"lightTrellis",
	"gray125",
	"gray0625"
];
function wi(e) {
	return e.map(function(e) {
		return [
			e >> 16 & 255,
			e >> 8 & 255,
			e & 255
		];
	});
}
var Ti = /*#__PURE__*/ gt(/* @__PURE__ */ wi([
	0,
	16777215,
	16711680,
	65280,
	255,
	16776960,
	16711935,
	65535,
	0,
	16777215,
	16711680,
	65280,
	255,
	16776960,
	16711935,
	65535,
	8388608,
	32768,
	128,
	8421376,
	8388736,
	32896,
	12632256,
	8421504,
	10066431,
	10040166,
	16777164,
	13434879,
	6684774,
	16744576,
	26316,
	13421823,
	128,
	16711935,
	16776960,
	65535,
	8388736,
	8388608,
	32896,
	255,
	52479,
	13434879,
	13434828,
	16777113,
	10079487,
	16751052,
	13408767,
	16764057,
	3368703,
	3394764,
	10079232,
	16763904,
	16750848,
	16737792,
	6710937,
	9868950,
	13158,
	3381606,
	13056,
	3355392,
	10040064,
	10040166,
	3355545,
	3355443,
	0,
	16777215,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0
])), Ei = {
	0: "#NULL!",
	7: "#DIV/0!",
	15: "#VALUE!",
	23: "#REF!",
	29: "#NAME?",
	36: "#NUM!",
	42: "#N/A",
	43: "#GETTING_DATA",
	255: "#WTF?"
}, Di = {
	"#NULL!": 0,
	"#DIV/0!": 7,
	"#VALUE!": 15,
	"#REF!": 23,
	"#NAME?": 29,
	"#NUM!": 36,
	"#N/A": 42,
	"#GETTING_DATA": 43,
	"#WTF?": 255
}, Oi = [
	"_xlnm.Consolidate_Area",
	"_xlnm.Auto_Open",
	"_xlnm.Auto_Close",
	"_xlnm.Extract",
	"_xlnm.Database",
	"_xlnm.Criteria",
	"_xlnm.Print_Area",
	"_xlnm.Print_Titles",
	"_xlnm.Recorder",
	"_xlnm.Data_Form",
	"_xlnm.Auto_Activate",
	"_xlnm.Auto_Deactivate",
	"_xlnm.Sheet_Title",
	"_xlnm._FilterDatabase"
], ki = {
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml": "workbooks",
	"application/vnd.ms-excel.sheet.macroEnabled.main+xml": "workbooks",
	"application/vnd.ms-excel.sheet.binary.macroEnabled.main": "workbooks",
	"application/vnd.ms-excel.addin.macroEnabled.main+xml": "workbooks",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml": "workbooks",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml": "sheets",
	"application/vnd.ms-excel.worksheet": "sheets",
	"application/vnd.ms-excel.binIndexWs": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml": "charts",
	"application/vnd.ms-excel.chartsheet": "charts",
	"application/vnd.ms-excel.macrosheet+xml": "macros",
	"application/vnd.ms-excel.macrosheet": "macros",
	"application/vnd.ms-excel.intlmacrosheet": "TODO",
	"application/vnd.ms-excel.binIndexMs": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml": "dialogs",
	"application/vnd.ms-excel.dialogsheet": "dialogs",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml": "strs",
	"application/vnd.ms-excel.sharedStrings": "strs",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml": "styles",
	"application/vnd.ms-excel.styles": "styles",
	"application/vnd.openxmlformats-package.core-properties+xml": "coreprops",
	"application/vnd.openxmlformats-officedocument.custom-properties+xml": "custprops",
	"application/vnd.openxmlformats-officedocument.extended-properties+xml": "extprops",
	"application/vnd.openxmlformats-officedocument.customXmlProperties+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml": "comments",
	"application/vnd.ms-excel.comments": "comments",
	"application/vnd.ms-excel.threadedcomments+xml": "threadedcomments",
	"application/vnd.ms-excel.person+xml": "people",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml": "metadata",
	"application/vnd.ms-excel.sheetMetadata": "metadata",
	"application/vnd.ms-excel.pivotTable": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.drawingml.chart+xml": "TODO",
	"application/vnd.ms-office.chartcolorstyle+xml": "TODO",
	"application/vnd.ms-office.chartstyle+xml": "TODO",
	"application/vnd.ms-office.chartex+xml": "TODO",
	"application/vnd.ms-excel.calcChain": "calcchains",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml": "calcchains",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings": "TODO",
	"application/vnd.ms-office.activeX": "TODO",
	"application/vnd.ms-office.activeX+xml": "TODO",
	"application/vnd.ms-excel.attachedToolbars": "TODO",
	"application/vnd.ms-excel.connections": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml": "TODO",
	"application/vnd.ms-excel.externalLink": "links",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml": "links",
	"application/vnd.ms-excel.pivotCacheDefinition": "TODO",
	"application/vnd.ms-excel.pivotCacheRecords": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml": "TODO",
	"application/vnd.ms-excel.queryTable": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml": "TODO",
	"application/vnd.ms-excel.userNames": "TODO",
	"application/vnd.ms-excel.revisionHeaders": "TODO",
	"application/vnd.ms-excel.revisionLog": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionHeaders+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.revisionLog+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.userNames+xml": "TODO",
	"application/vnd.ms-excel.tableSingleCells": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.tableSingleCells+xml": "TODO",
	"application/vnd.ms-excel.slicer": "TODO",
	"application/vnd.ms-excel.slicerCache": "TODO",
	"application/vnd.ms-excel.slicer+xml": "TODO",
	"application/vnd.ms-excel.slicerCache+xml": "TODO",
	"application/vnd.ms-excel.wsSortMap": "TODO",
	"application/vnd.ms-excel.table": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.theme+xml": "themes",
	"application/vnd.openxmlformats-officedocument.themeOverride+xml": "TODO",
	"application/vnd.ms-excel.Timeline+xml": "TODO",
	"application/vnd.ms-excel.TimelineCache+xml": "TODO",
	"application/vnd.ms-office.vbaProject": "vba",
	"application/vnd.ms-office.vbaProjectSignature": "TODO",
	"application/vnd.ms-office.volatileDependencies": "TODO",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.volatileDependencies+xml": "TODO",
	"application/vnd.ms-excel.controlproperties+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.model+data": "TODO",
	"application/vnd.ms-excel.Survey+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.drawing+xml": "drawings",
	"application/vnd.openxmlformats-officedocument.drawingml.chartshapes+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml": "TODO",
	"application/vnd.openxmlformats-officedocument.vmlDrawing": "TODO",
	"application/vnd.openxmlformats-package.relationships+xml": "rels",
	"application/vnd.openxmlformats-officedocument.oleObject": "TODO",
	"image/png": "TODO",
	sheet: "js"
};
function Ai() {
	return {
		workbooks: [],
		sheets: [],
		charts: [],
		dialogs: [],
		macros: [],
		rels: [],
		strs: [],
		comments: [],
		threadedcomments: [],
		links: [],
		coreprops: [],
		extprops: [],
		custprops: [],
		themes: [],
		styles: [],
		calcchains: [],
		vba: [],
		drawings: [],
		metadata: [],
		people: [],
		TODO: [],
		xmlns: ""
	};
}
function ji(e) {
	var t = Ai();
	if (!e || !e.match) return t;
	var n = {};
	if ((e.match(en) || []).forEach(function(e) {
		var r = K(e);
		switch (r[0].replace(tn, "<")) {
			case "<?xml": break;
			case "<Types":
				t.xmlns = r["xmlns" + (r[0].match(/<(\w+):/) || ["", ""])[1]];
				break;
			case "<Default":
				n[r.Extension.toLowerCase()] = r.ContentType;
				break;
			case "<Override":
				t[ki[r.ContentType]] !== void 0 && t[ki[r.ContentType]].push(r.PartName);
				break;
		}
	}), t.xmlns !== kn.CT) throw Error("Unknown Namespace: " + t.xmlns);
	return t.calcchain = t.calcchains.length > 0 ? t.calcchains[0] : "", t.sst = t.strs.length > 0 ? t.strs[0] : "", t.style = t.styles.length > 0 ? t.styles[0] : "", t.defaults = n, delete t.calcchains, t;
}
var Mi = {
	WB: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
	SHEET: "http://sheetjs.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
	HLINK: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
	VML: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing",
	XPATH: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath",
	XMISS: "http://schemas.microsoft.com/office/2006/relationships/xlExternalLinkPath/xlPathMissing",
	XLINK: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink",
	CXML: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
	CXMLP: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps",
	CMNT: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
	CORE_PROPS: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
	EXT_PROPS: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
	CUST_PROPS: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
	SST: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
	STY: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
	THEME: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
	CHART: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
	CHARTEX: "http://schemas.microsoft.com/office/2014/relationships/chartEx",
	CS: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet",
	WS: ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet"],
	DS: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/dialogsheet",
	MS: "http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet",
	IMG: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
	DRAW: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
	XLMETA: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata",
	TCMNT: "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment",
	PEOPLE: "http://schemas.microsoft.com/office/2017/10/relationships/person",
	CONN: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections",
	VBA: "http://schemas.microsoft.com/office/2006/relationships/vbaProject"
};
function Ni(e) {
	var t = e.lastIndexOf("/");
	return e.slice(0, t + 1) + "_rels/" + e.slice(t + 1) + ".rels";
}
function Pi(e, t) {
	var n = { "!id": {} };
	if (!e) return n;
	t.charAt(0) !== "/" && (t = "/" + t);
	var r = {};
	return (e.match(en) || []).forEach(function(e) {
		var i = K(e);
		if (i[0] === "<Relationship") {
			var a = {};
			a.Type = i.Type, a.Target = q(i.Target), a.Id = i.Id, i.TargetMode && (a.TargetMode = i.TargetMode);
			var o = i.TargetMode === "External" ? i.Target : Xt(i.Target, t);
			n[o] = a, r[i.Id] = a;
		}
	}), n["!id"] = r, n;
}
var Fi = "application/vnd.oasis.opendocument.spreadsheet";
function Ii(e, t) {
	for (var n = Dn(e), r, i; r = On.exec(n);) switch (r[3]) {
		case "manifest": break;
		case "file-entry":
			if (i = K(r[0], !1), i.path == "/" && i.type !== Fi) throw Error("This OpenDocument is not a spreadsheet");
			break;
		case "encryption-data":
		case "algorithm":
		case "start-key-generation":
		case "key-derivation": throw Error("Unsupported ODS Encryption");
		default: if (t && t.WTF) throw r;
	}
}
var Li = [
	["cp:category", "Category"],
	["cp:contentStatus", "ContentStatus"],
	["cp:keywords", "Keywords"],
	["cp:lastModifiedBy", "LastAuthor"],
	["cp:lastPrinted", "LastPrinted"],
	["cp:revision", "RevNumber"],
	["cp:version", "Version"],
	["dc:creator", "Author"],
	["dc:description", "Comments"],
	["dc:identifier", "Identifier"],
	["dc:language", "Language"],
	["dc:subject", "Subject"],
	["dc:title", "Title"],
	[
		"dcterms:created",
		"CreatedDate",
		"date"
	],
	[
		"dcterms:modified",
		"ModifiedDate",
		"date"
	]
];
function Ri(e) {
	var t = {};
	e = vn(e);
	for (var n = 0; n < Li.length; ++n) {
		var r = Li[n], i = Pt(e, r[0]);
		i != null && i.length > 0 && (t[r[1]] = q(i[1])), r[2] === "date" && t[r[1]] && (t[r[1]] = mt(t[r[1]]));
	}
	return t;
}
var zi = [
	[
		"Application",
		"Application",
		"string"
	],
	[
		"AppVersion",
		"AppVersion",
		"string"
	],
	[
		"Company",
		"Company",
		"string"
	],
	[
		"DocSecurity",
		"DocSecurity",
		"string"
	],
	[
		"Manager",
		"Manager",
		"string"
	],
	[
		"HyperlinksChanged",
		"HyperlinksChanged",
		"bool"
	],
	[
		"SharedDoc",
		"SharedDoc",
		"bool"
	],
	[
		"LinksUpToDate",
		"LinksUpToDate",
		"bool"
	],
	[
		"ScaleCrop",
		"ScaleCrop",
		"bool"
	],
	[
		"HeadingPairs",
		"HeadingPairs",
		"raw"
	],
	[
		"TitlesOfParts",
		"TitlesOfParts",
		"raw"
	]
];
function Bi(e, t, n, r) {
	var i = [];
	if (typeof e == "string") i = Cn(e, r);
	else for (var a = 0; a < e.length; ++a) i = i.concat(e[a].map(function(e) {
		return { v: e };
	}));
	var o = typeof t == "string" ? Cn(t, r).map(function(e) {
		return e.v;
	}) : t, s = 0, c = 0;
	if (o.length > 0) for (var l = 0; l !== i.length; l += 2) {
		switch (c = +i[l + 1].v, i[l].v) {
			case "Worksheets":
			case "工作表":
			case "Листы":
			case "أوراق العمل":
			case "ワークシート":
			case "גליונות עבודה":
			case "Arbeitsblätter":
			case "Çalışma Sayfaları":
			case "Feuilles de calcul":
			case "Fogli di lavoro":
			case "Folhas de cálculo":
			case "Planilhas":
			case "Regneark":
			case "Hojas de cálculo":
			case "Werkbladen":
				n.Worksheets = c, n.SheetNames = o.slice(s, s + c);
				break;
			case "Named Ranges":
			case "Rangos con nombre":
			case "名前付き一覧":
			case "Benannte Bereiche":
			case "Navngivne områder":
				n.NamedRanges = c, n.DefinedNames = o.slice(s, s + c);
				break;
			case "Charts":
			case "Diagramme":
				n.Chartsheets = c, n.ChartNames = o.slice(s, s + c);
				break;
		}
		s += c;
	}
}
function Vi(e, t, n) {
	var r = {};
	return t || (t = {}), e = vn(e), zi.forEach(function(n) {
		var i = (Ft(e, n[0]) || [])[1];
		switch (n[2]) {
			case "string":
				i && (t[n[1]] = q(i));
				break;
			case "bool":
				t[n[1]] = i === "true";
				break;
			case "raw":
				var a = Pt(e, n[0]);
				a && a.length > 0 && (r[n[1]] = a[1]);
				break;
		}
	}), r.HeadingPairs && r.TitlesOfParts && Bi(r.HeadingPairs, r.TitlesOfParts, t, n), t;
}
var Hi = /<[^<>]+>[^<]*/g;
function Ui(e, t) {
	var n = {}, r = "", i = e.match(Hi);
	if (i) for (var a = 0; a != i.length; ++a) {
		var o = i[a], s = K(o);
		switch (an(s[0])) {
			case "<?xml": break;
			case "<Properties": break;
			case "<property":
				r = q(s.name);
				break;
			case "</property>":
				r = null;
				break;
			default: if (o.indexOf("<vt:") === 0) {
				var c = o.split(">"), l = c[0].slice(4), u = c[1];
				switch (l) {
					case "lpstr":
					case "bstr":
					case "lpwstr":
						n[r] = q(u);
						break;
					case "bool":
						n[r] = J(u);
						break;
					case "i1":
					case "i2":
					case "i4":
					case "i8":
					case "int":
					case "uint":
						n[r] = parseInt(u, 10);
						break;
					case "r4":
					case "r8":
					case "decimal":
						n[r] = parseFloat(u);
						break;
					case "filetime":
					case "date":
						n[r] = mt(u);
						break;
					case "cy":
					case "error":
						n[r] = q(u);
						break;
					default:
						if (l.slice(-1) == "/") break;
						t.WTF && typeof console < "u" && console.warn("Unexpected", o, l, c);
				}
			} else if (o.slice(0, 2) !== "</" && t.WTF) throw Error(o);
		}
	}
	return n;
}
var Wi = {
	Title: "Title",
	Subject: "Subject",
	Author: "Author",
	Keywords: "Keywords",
	Comments: "Description",
	LastAuthor: "LastAuthor",
	RevNumber: "Revision",
	Application: "AppName",
	LastPrinted: "LastPrinted",
	CreatedDate: "Created",
	ModifiedDate: "LastSaved",
	Category: "Category",
	Manager: "Manager",
	Company: "Company",
	AppVersion: "Version",
	ContentStatus: "ContentStatus",
	Identifier: "Identifier",
	Language: "Language"
}, Gi;
function Ki(e, t, n) {
	Gi || (Gi = it(Wi)), t = Gi[t] || t, e[t] = n;
}
function qi(e) {
	var t = e.read_shift(4), n = e.read_shift(4);
	return (/* @__PURE__ */ new Date((n / 1e7 * 2 ** 32 + t / 1e7 - 11644473600) * 1e3)).toISOString().replace(/\.000/, "");
}
function Ji(e, t, n) {
	var r = e.l, i = e.read_shift(0, "lpstr-cp");
	if (n) for (; e.l - r & 3;) ++e.l;
	return i;
}
function Yi(e, t, n) {
	var r = e.read_shift(0, "lpwstr");
	return n && (e.l += 4 - (r.length + 1 & 3) & 3), r;
}
function Xi(e, t, n) {
	return t === 31 ? Yi(e) : Ji(e, t, n);
}
function Zi(e, t, n) {
	return Xi(e, t, n === !1 ? 0 : 4);
}
function Qi(e, t) {
	if (!t) throw Error("VtUnalignedString must have positive length");
	return Xi(e, t, 0);
}
function $i(e) {
	for (var t = e.read_shift(4), n = [], r = 0; r != t; ++r) {
		var i = e.l;
		n[r] = e.read_shift(0, "lpwstr").replace(M, ""), e.l - i & 2 && (e.l += 2);
	}
	return n;
}
function ea(e) {
	for (var t = e.read_shift(4), n = [], r = 0; r != t; ++r) n[r] = e.read_shift(0, "lpstr-cp").replace(M, "");
	return n;
}
function ta(e) {
	var t = e.l, n = oa(e, vi);
	return e[e.l] == 0 && e[e.l + 1] == 0 && e.l - t & 2 && (e.l += 2), [n, oa(e, ci)];
}
function na(e) {
	for (var t = e.read_shift(4), n = [], r = 0; r < t / 2; ++r) n.push(ta(e));
	return n;
}
function ra(e, t) {
	for (var n = e.read_shift(4), r = {}, i = 0; i != n; ++i) {
		var a = e.read_shift(4), o = e.read_shift(4);
		r[a] = e.read_shift(o, t === 1200 ? "utf16le" : "utf8").replace(M, "").replace(N, "!"), t === 1200 && o % 2 && (e.l += 2);
	}
	return e.l & 3 && (e.l = e.l >> 3 << 2), r;
}
function ia(e) {
	var t = e.read_shift(4), n = e.slice(e.l, e.l + t);
	return e.l += t, (t & 3) > 0 && (e.l += 4 - (t & 3) & 3), n;
}
function aa(e) {
	var t = {};
	return t.Size = e.read_shift(4), e.l += t.Size + 3 - (t.Size - 1) % 4, t;
}
function oa(e, t, n) {
	var r = e.read_shift(2), i, a = n || {};
	if (e.l += 2, t !== ui && r !== t && yi.indexOf(t) === -1 && !((t & 65534) == 4126 && (r & 65534) == 4126)) throw Error("Expected type " + t + " saw " + r);
	switch (t === ui ? r : t) {
		case 2: return i = e.read_shift(2, "i"), a.raw || (e.l += 2), i;
		case 3: return i = e.read_shift(4, "i"), i;
		case 11: return e.read_shift(4) !== 0;
		case 19: return i = e.read_shift(4), i;
		case 30:
			e.l += 4, val = Zi(e, e[e.l - 4]).replace(/(^|[^\u0000])\u0000+$/, "$1");
			break;
		case 31:
			e.l += 4, val = Zi(e, e[e.l - 4]).replace(/(^|[^\u0000])\u0000+$/, "$1");
			break;
		case 64: return qi(e);
		case 65: return ia(e);
		case 71: return aa(e);
		case 80: return Zi(e, r, !a.raw).replace(M, "");
		case 81: return Qi(e, r).replace(M, "");
		case 4108: return na(e);
		case 4126:
		case 4127: return r == 4127 ? $i(e) : ea(e);
		default: throw Error("TypedPropertyValue unrecognized type " + t + " " + r);
	}
}
function sa(e, t) {
	var n = e.l, r = e.read_shift(4), i = e.read_shift(4), a = [], o = 0, s = 0, l = -1, u = {};
	for (o = 0; o != i; ++o) a[o] = [e.read_shift(4), e.read_shift(4) + n];
	a.sort(function(e, t) {
		return e[1] - t[1];
	});
	var d = {};
	for (o = 0; o != i; ++o) {
		if (e.l !== a[o][1]) {
			var f = !0;
			if (o > 0 && t) switch (t[a[o - 1][0]].t) {
				case 2:
					e.l + 2 === a[o][1] && (e.l += 2, f = !1);
					break;
				case 80:
					e.l <= a[o][1] && (e.l = a[o][1], f = !1);
					break;
				case 4108:
					e.l <= a[o][1] && (e.l = a[o][1], f = !1);
					break;
			}
			if ((!t || o == 0) && e.l <= a[o][1] && (f = !1, e.l = a[o][1]), f) throw Error("Read Error: Expected address " + a[o][1] + " at " + e.l + " :" + o);
		}
		if (t) {
			if (a[o][0] == 0 && a.length > o + 1 && a[o][1] == a[o + 1][1]) continue;
			var p = t[a[o][0]];
			if (d[p.n] = oa(e, p.t, { raw: !0 }), p.p === "version" && (d[p.n] = String(d[p.n] >> 16) + "." + ("0000" + String(d[p.n] & 65535)).slice(-4)), p.n == "CodePage") switch (d[p.n]) {
				case 0: d[p.n] = 1252;
				case 874:
				case 932:
				case 936:
				case 949:
				case 950:
				case 1250:
				case 1251:
				case 1253:
				case 1254:
				case 1255:
				case 1256:
				case 1257:
				case 1258:
				case 1e4:
				case 1200:
				case 1201:
				case 1252:
				case 65e3:
				case -536:
				case 65001:
				case -535:
					c(s = d[p.n] >>> 0 & 65535);
					break;
				default: throw Error("Unsupported CodePage: " + d[p.n]);
			}
		} else if (a[o][0] === 1) {
			if (s = d.CodePage = oa(e, si), c(s), l !== -1) {
				var m = e.l;
				e.l = a[l][1], u = ra(e, s), e.l = m;
			}
		} else if (a[o][0] === 0) {
			if (s === 0) {
				l = o, e.l = a[o + 1][1];
				continue;
			}
			u = ra(e, s);
		} else {
			var h = u[a[o][0]], g;
			switch (e[e.l]) {
				case 65:
					e.l += 4, g = ia(e);
					break;
				case 30:
					e.l += 4, g = Zi(e, e[e.l - 4]).replace(/(^|[^\u0000])\u0000+$/, "$1");
					break;
				case 31:
					e.l += 4, g = Zi(e, e[e.l - 4]).replace(/(^|[^\u0000])\u0000+$/, "$1");
					break;
				case 3:
					e.l += 4, g = e.read_shift(4, "i");
					break;
				case 19:
					e.l += 4, g = e.read_shift(4);
					break;
				case 5:
					e.l += 4, g = e.read_shift(8, "f");
					break;
				case 11:
					e.l += 4, g = da(e, 4);
					break;
				case 64:
					e.l += 4, g = mt(qi(e));
					break;
				default: throw Error("unparsed value: " + e[e.l]);
			}
			d[h] = g;
		}
	}
	return e.l = n + r, d;
}
function ca(e, t, n) {
	var r = e.content;
	if (!r) return {};
	pr(r, 0);
	var i, a, o, s, c = 0;
	r.chk("feff", "Byte Order: "), r.read_shift(2);
	var l = r.read_shift(4), u = r.read_shift(16);
	if (u !== et.utils.consts.HEADER_CLSID && u !== n) throw Error("Bad PropertySet CLSID " + u);
	if (i = r.read_shift(4), i !== 1 && i !== 2) throw Error("Unrecognized #Sets: " + i);
	if (a = r.read_shift(16), s = r.read_shift(4), i === 1 && s !== r.l) throw Error("Length mismatch: " + s + " !== " + r.l);
	i === 2 && (o = r.read_shift(16), c = r.read_shift(4));
	var d = sa(r, t), f = { SystemIdentifier: l };
	for (var p in d) f[p] = d[p];
	if (f.FMTID = a, i === 1) return f;
	if (c - r.l == 2 && (r.l += 2), r.l !== c) throw Error("Length mismatch 2: " + r.l + " !== " + c);
	var m;
	try {
		m = sa(r, null);
	} catch {}
	for (p in m) f[p] = m[p];
	return f.FMTID = [a, o], f;
}
function la(e, t) {
	return e.read_shift(t), null;
}
function ua(e, t, n) {
	for (var r = [], i = e.l + t; e.l < i;) r.push(n(e, i - e.l));
	if (i !== e.l) throw Error("Slurp error");
	return r;
}
function da(e, t) {
	return e.read_shift(t) === 1;
}
function fa(e) {
	return e.read_shift(2, "u");
}
function pa(e, t) {
	return ua(e, t, fa);
}
function ma(e) {
	var t = e.read_shift(1);
	return e.read_shift(1) === 1 ? t : t === 1;
}
function ha(e, n, r) {
	var i = e.read_shift(r && r.biff >= 12 ? 2 : 1), a = "sbcs-cont", o = t;
	r && r.biff >= 8 && (t = 1200), !r || r.biff == 8 ? e.read_shift(1) && (a = "dbcs-cont") : r.biff == 12 && (a = "wstr"), r.biff >= 2 && r.biff <= 5 && (a = "cpstr");
	var s = i ? e.read_shift(i, a) : "";
	return t = o, s;
}
function ga(e) {
	var n = t;
	t = 1200;
	var r = e.read_shift(2), i = e.read_shift(1), a = i & 4, o = i & 8, s = 1 + (i & 1), c = 0, l, u = {};
	o && (c = e.read_shift(2)), a && (l = e.read_shift(4));
	var d = s == 2 ? "dbcs-cont" : "sbcs-cont", f = r === 0 ? "" : e.read_shift(r, d);
	return o && (e.l += 4 * c), a && (e.l += l), u.t = f, o || (u.raw = "<t>" + u.t + "</t>", u.r = u.t), t = n, u;
}
function _a(e, t, n) {
	var r;
	if (n) {
		if (n.biff >= 2 && n.biff <= 5) return e.read_shift(t, "cpstr");
		if (n.biff >= 12) return e.read_shift(t, "dbcs-cont");
	}
	return r = e.read_shift(1) === 0 ? e.read_shift(t, "sbcs-cont") : e.read_shift(t, "dbcs-cont"), r;
}
function va(e, t, n) {
	var r = e.read_shift(n && n.biff == 2 ? 1 : 2);
	return r === 0 ? (n.biff <= 8 && e.l++, "") : _a(e, r, n);
}
function ya(e, t, n) {
	if (n.biff > 5) return va(e, t, n);
	var r = e.read_shift(1);
	return r === 0 ? (e.l++, "") : e.read_shift(r, n.biff <= 4 || !e.lens ? "cpstr" : "sbcs-cont");
}
function ba(e) {
	var t = e.read_shift(1);
	e.l++;
	var n = e.read_shift(2);
	return e.l += 2, [t, n];
}
function xa(e) {
	var t = e.read_shift(4), n = e.l, r = !1;
	t > 24 && (e.l += t - 24, e.read_shift(16) === "795881f43b1d7f48af2c825dc4852763" && (r = !0), e.l = n);
	var i = e.read_shift((r ? t - 24 : t) >> 1, "utf16le").replace(M, "");
	return r && (e.l += 24), i;
}
function Sa(e) {
	for (var t = e.read_shift(2), n = ""; t-- > 0;) n += "../";
	var r = e.read_shift(0, "lpstr-ansi");
	if (e.l += 2, e.read_shift(2) != 57005) throw Error("Bad FileMoniker");
	if (e.read_shift(4) === 0) return n + r.replace(/\\/g, "/");
	var i = e.read_shift(4);
	if (e.read_shift(2) != 3) throw Error("Bad FileMoniker");
	var a = e.read_shift(i >> 1, "utf16le").replace(M, "");
	return n + a;
}
function Ca(e, t) {
	var n = e.read_shift(16);
	switch (t -= 16, n) {
		case "e0c9ea79f9bace118c8200aa004ba90b": return xa(e, t);
		case "0303000000000000c000000000000046": return Sa(e, t);
		default: throw Error("Unsupported Moniker " + n);
	}
}
function wa(e) {
	var t = e.read_shift(4);
	return t > 0 ? e.read_shift(t, "utf16le").replace(M, "") : "";
}
function Ta(e, t) {
	var n = e.l + t, r = e.read_shift(4);
	if (r !== 2) throw Error("Unrecognized streamVersion: " + r);
	var i = e.read_shift(2);
	e.l += 2;
	var a, o, s, c, l = "", u, d;
	i & 16 && (a = wa(e, n - e.l)), i & 128 && (o = wa(e, n - e.l)), (i & 257) == 257 && (s = wa(e, n - e.l)), (i & 257) == 1 && (c = Ca(e, n - e.l)), i & 8 && (l = wa(e, n - e.l)), i & 32 && (u = e.read_shift(16)), i & 64 && (d = qi(e)), e.l = n;
	var f = o || s || c || "";
	f && l && (f += "#" + l), f || (f = "#" + l), i & 2 && f.charAt(0) == "/" && f.charAt(1) != "/" && (f = "file://" + f);
	var p = { Target: f };
	return u && (p.guid = u), d && (p.time = d), a && (p.Tooltip = a), p;
}
function Ea(e) {
	return [
		e.read_shift(1),
		e.read_shift(1),
		e.read_shift(1),
		e.read_shift(1)
	];
}
function Da(e, t) {
	var n = Ea(e, t);
	return n[3] = 0, n;
}
function Oa(e, t, n) {
	var r = {
		r: e.read_shift(2),
		c: e.read_shift(2),
		ixfe: 0
	};
	return n && n.biff == 2 || t == 7 ? (r.ixfe = e.read_shift(1) & 63, e.l += 2) : r.ixfe = e.read_shift(2), r;
}
function ka(e) {
	var t = e.read_shift(2), n = e.read_shift(2);
	return e.l += 8, {
		type: t,
		flags: n
	};
}
function Aa(e, t, n) {
	return t === 0 ? "" : ya(e, t, n);
}
function ja(e, t, n) {
	var r = n.biff > 8 ? 4 : 2;
	return [
		e.read_shift(r),
		e.read_shift(r, "i"),
		e.read_shift(r, "i")
	];
}
function Ma(e) {
	return [e.read_shift(2), Qr(e)];
}
function Na(e, t, n) {
	e.l += 4, t -= 4;
	var r = e.l + t, i = ha(e, t, n), a = e.read_shift(2);
	if (r -= e.l, a !== r) throw Error("Malformed AddinUdf: padding = " + r + " != " + a);
	return e.l += a, i;
}
function Pa(e) {
	var t = e.read_shift(2), n = e.read_shift(2), r = e.read_shift(2), i = e.read_shift(2);
	return {
		s: {
			c: r,
			r: t
		},
		e: {
			c: i,
			r: n
		}
	};
}
function Fa(e) {
	var t = e.read_shift(2), n = e.read_shift(2), r = e.read_shift(1), i = e.read_shift(1);
	return {
		s: {
			c: r,
			r: t
		},
		e: {
			c: i,
			r: n
		}
	};
}
var Ia = Fa;
function La(e) {
	e.l += 4;
	var t = e.read_shift(2), n = e.read_shift(2), r = e.read_shift(2);
	return e.l += 12, [
		n,
		t,
		r
	];
}
function Ra(e) {
	var t = {};
	return e.l += 4, e.l += 16, t.fSharedNote = e.read_shift(2), e.l += 4, t;
}
function za(e) {
	return e.l += 4, e.cf = e.read_shift(2), {};
}
function Ba(e) {
	e.l += 2, e.l += e.read_shift(2);
}
var Va = {
	0: Ba,
	4: Ba,
	5: Ba,
	6: Ba,
	7: za,
	8: Ba,
	9: Ba,
	10: Ba,
	11: Ba,
	12: Ba,
	13: Ra,
	14: Ba,
	15: Ba,
	16: Ba,
	17: Ba,
	18: Ba,
	19: Ba,
	20: Ba,
	21: La
};
function Ha(e, t) {
	for (var n = e.l + t, r = []; e.l < n;) {
		var i = e.read_shift(2);
		e.l -= 2;
		try {
			r[i] = Va[i](e, n - e.l);
		} catch {
			return e.l = n, r;
		}
	}
	return e.l != n && (e.l = n), r;
}
function Ua(e, t) {
	var n = {
		BIFFVer: 0,
		dt: 0
	};
	switch (n.BIFFVer = e.read_shift(2), t -= 2, t >= 2 && (n.dt = e.read_shift(2), e.l -= 2), n.BIFFVer) {
		case 1536:
		case 1280:
		case 1024:
		case 768:
		case 512:
		case 2:
		case 7: break;
		default: if (t > 6) throw Error("Unexpected BIFF Ver " + n.BIFFVer);
	}
	return e.read_shift(t), n;
}
function Wa(e, t) {
	return t === 0 || e.read_shift(2), 1200;
}
function Ga(e, t, n) {
	if (n.enc) return e.l += t, "";
	var r = e.l, i = ya(e, 0, n);
	return e.read_shift(t + r - e.l), i;
}
function Ka(e, t, n) {
	var r = n && n.biff == 8 || t == 2 ? e.read_shift(2) : (e.l += t, 0);
	return {
		fDialog: r & 16,
		fBelow: r & 64,
		fRight: r & 128
	};
}
function qa(e, t, n) {
	var r = "";
	if (n.biff == 4) return r = ha(e, 0, n), r.length === 0 && (r = "Sheet1"), { name: r };
	var i = e.read_shift(4), a = e.read_shift(1) & 3, o = e.read_shift(1);
	switch (o) {
		case 0:
			o = "Worksheet";
			break;
		case 1:
			o = "Macrosheet";
			break;
		case 2:
			o = "Chartsheet";
			break;
		case 6:
			o = "VBAModule";
			break;
	}
	return r = ha(e, 0, n), r.length === 0 && (r = "Sheet1"), {
		pos: i,
		hs: a,
		dt: o,
		name: r
	};
}
function Ja(e, t) {
	for (var n = e.l + t, r = e.read_shift(4), i = e.read_shift(4), a = [], o = 0; o != i && e.l < n; ++o) a.push(ga(e));
	return a.Count = r, a.Unique = i, a;
}
function Ya(e, t) {
	var n = {};
	return n.dsst = e.read_shift(2), e.l += t - 2, n;
}
function Xa(e) {
	var t = {};
	t.r = e.read_shift(2), t.c = e.read_shift(2), t.cnt = e.read_shift(2) - t.c;
	var n = e.read_shift(2);
	e.l += 4;
	var r = e.read_shift(1);
	e.l += 1;
	var i = e.read_shift(2);
	return t.ixfe = i & 4095, t.flags = i >> 12 & 15, r & 7 && (t.level = r & 7), r & 32 && (t.hidden = !0), r & 64 && (t.hpt = n / 20), t;
}
function Za(e) {
	var t = ka(e);
	if (t.type != 2211) throw Error("Invalid Future Record " + t.type);
	return e.read_shift(4) !== 0;
}
function Qa(e) {
	return e.read_shift(2), e.read_shift(4);
}
function $a(e, t, n) {
	var r = 0;
	n && n.biff == 2 || (r = e.read_shift(2));
	var i = e.read_shift(2);
	return n && n.biff == 2 && (r = 1 - (i >> 15), i &= 32767), [{
		Unsynced: r & 1,
		DyZero: (r & 2) >> 1,
		ExAsc: (r & 4) >> 2,
		ExDsc: (r & 8) >> 3
	}, i];
}
function eo(e) {
	var t = e.read_shift(2), n = e.read_shift(2), r = e.read_shift(2), i = e.read_shift(2), a = e.read_shift(2), o = e.read_shift(2), s = e.read_shift(2), c = e.read_shift(2), l = e.read_shift(2);
	return {
		Pos: [t, n],
		Dim: [r, i],
		Flags: a,
		CurTab: o,
		FirstTab: s,
		Selected: c,
		TabRatio: l
	};
}
function to(e, t, n) {
	return n && n.biff >= 2 && n.biff < 5 ? {} : { RTL: e.read_shift(2) & 64 };
}
function no() {}
function ro(e, t, n) {
	var r = e.l + t, i = {
		dyHeight: e.read_shift(2),
		fl: e.read_shift(2)
	};
	switch (i.sz = i.dyHeight / 20, i.italic = !!(i.fl & 2), i.strike = !!(i.fl & 8), i.outline = !!(i.fl & 16), i.shadow = !!(i.fl & 32), i.condense = !!(i.fl & 64), i.extend = !!(i.fl & 128), n && n.biff || 8) {
		case 2: break;
		case 3:
		case 4:
			i.icv = e.read_shift(2);
			break;
		default:
			i.icv = e.read_shift(2), i.bls = e.read_shift(2), i.bold = i.bls >= 700, i.vertAlign = e.read_shift(2), i.underline = e.read_shift(1), i.family = e.read_shift(1), i.charset = e.read_shift(1), e.l++;
			break;
	}
	return i.name = e.l < r ? ha(e, r - e.l, n) : "", i;
}
function io(e, t, n) {
	var r = Oa(e, t, n);
	return r.isst = e.read_shift(4), r;
}
function ao(e, t, n) {
	n.biffguess && n.biff == 2 && (n.biff = 5);
	var r = e.l + t, i = Oa(e, t, n);
	return i.val = va(e, r - e.l, n), i;
}
function oo(e, t, n) {
	return [e.read_shift(2), ya(e, 0, n)];
}
var so = ya;
function co(e, t, n) {
	var r = e.l + t, i = n.biff == 8 || !n.biff ? 4 : 2, a = e.read_shift(i), o = e.read_shift(i), s = e.read_shift(2), c = e.read_shift(2);
	return e.l = r, {
		s: {
			r: a,
			c: s
		},
		e: {
			r: o,
			c
		}
	};
}
function lo(e) {
	var t = e.read_shift(2), n = e.read_shift(2), r = Ma(e);
	return {
		r: t,
		c: n,
		ixfe: r[0],
		rknum: r[1]
	};
}
function uo(e, t) {
	for (var n = e.l + t - 2, r = e.read_shift(2), i = e.read_shift(2), a = []; e.l < n;) a.push(Ma(e));
	if (e.l !== n) throw Error("MulRK read error");
	var o = e.read_shift(2);
	if (a.length != o - i + 1) throw Error("MulRK length mismatch");
	return {
		r,
		c: i,
		C: o,
		rkrec: a
	};
}
function fo(e, t) {
	for (var n = e.l + t - 2, r = e.read_shift(2), i = e.read_shift(2), a = []; e.l < n;) a.push(e.read_shift(2));
	if (e.l !== n) throw Error("MulBlank read error");
	var o = e.read_shift(2);
	if (a.length != o - i + 1) throw Error("MulBlank length mismatch");
	return {
		r,
		c: i,
		C: o,
		ixfe: a
	};
}
function po(e, t, n, r) {
	var i = {}, a = e.read_shift(4), o = e.read_shift(4), s = e.read_shift(4), c = e.read_shift(2);
	return i.patternType = Ci[s >> 26], i.alc = a & 7, i.fWrap = a >> 3 & 1, i.alcV = a >> 4 & 7, i.fJustLast = a >> 7 & 1, i.trot = a >> 8 & 255, i.cIndent = a >> 16 & 15, i.fShrinkToFit = a >> 20 & 1, i.iReadOrder = a >> 22 & 2, i.fAtrNum = a >> 26 & 1, i.fAtrFnt = a >> 27 & 1, i.fAtrAlc = a >> 28 & 1, i.fAtrBdr = a >> 29 & 1, i.fAtrPat = a >> 30 & 1, i.fAtrProt = a >> 31 & 1, i.dgLeft = o & 15, i.dgRight = o >> 4 & 15, i.dgTop = o >> 8 & 15, i.dgBottom = o >> 12 & 15, i.icvLeft = o >> 16 & 127, i.icvRight = o >> 23 & 127, i.grbitDiag = o >> 30 & 3, i.icvTop = s & 127, i.icvBottom = s >> 7 & 127, i.icvDiag = s >> 14 & 127, i.dgDiag = s >> 21 & 15, i.icvFore = c & 127, i.icvBack = c >> 7 & 127, i.fsxButton = c >> 14 & 1, i;
}
function mo(e, t, n) {
	var r = {};
	return r.ifnt = e.read_shift(2), r.numFmtId = e.read_shift(2), r.flags = e.read_shift(2), r.locked = !!(r.flags & 1), r.hidden = !!(r.flags & 2), r.fStyle = r.flags >> 2 & 1, r.xfId = r.ixfeParent = r.flags >> 4 & 4095, t -= 6, r.data = po(e, t, r.fStyle, n), r;
}
function ho(e) {
	var t = {};
	return t.ifnt = e.read_shift(1), e.l++, t.flags = e.read_shift(1), t.numFmtId = t.flags & 63, t.flags >>= 6, t.fStyle = 0, t.data = {}, t;
}
function go(e) {
	var t = {};
	return t.ifnt = e.read_shift(1), t.numFmtId = e.read_shift(1), t.flags = e.read_shift(2), t.fStyle = t.flags >> 2 & 1, t.data = {}, t;
}
function _o(e) {
	var t = {};
	return t.ifnt = e.read_shift(1), t.numFmtId = e.read_shift(1), t.flags = e.read_shift(2), t.fStyle = t.flags >> 2 & 1, t.data = {}, t;
}
function vo(e) {
	e.l += 4;
	var t = [e.read_shift(2), e.read_shift(2)];
	if (t[0] !== 0 && t[0]--, t[1] !== 0 && t[1]--, t[0] > 7 || t[1] > 7) throw Error("Bad Gutters: " + t.join("|"));
	return t;
}
function yo(e, t, n) {
	var r = Oa(e, 6, n), i = ma(e, 2);
	return r.val = i, r.t = i === !0 || i === !1 ? "b" : "e", r;
}
function bo(e, t, n) {
	n.biffguess && n.biff == 2 && (n.biff = 5);
	var r = Oa(e, 6, n);
	return r.val = ti(e, 8), r;
}
var xo = Aa;
function So(e, t, n) {
	var r = e.l + t, i = e.read_shift(2), a = e.read_shift(2);
	if (n.sbcch = a, a == 1025 || a == 14849) return [a, i];
	if (a < 1 || a > 255) throw Error("Unexpected SupBook type: " + a);
	for (var o = _a(e, a), s = []; r > e.l;) s.push(va(e, r - e.l, n));
	return [
		a,
		i,
		o,
		s
	];
}
function Co(e, t, n) {
	var r = e.read_shift(2), i, a = {
		fBuiltIn: r & 1,
		fWantAdvise: r >>> 1 & 1,
		fWantPict: r >>> 2 & 1,
		fOle: r >>> 3 & 1,
		fOleLink: r >>> 4 & 1,
		cf: r >>> 5 & 1023,
		fIcon: r >>> 15 & 1
	};
	return n.sbcch === 14849 && (i = Na(e, t - 2, n)), a.body = i || e.read_shift(t - 2), typeof i == "string" && (a.Name = i), a;
}
function wo(e, t, n) {
	var r = e.l + t, i = e.read_shift(2), a = e.read_shift(1), o = e.read_shift(1), s = e.read_shift(n && n.biff == 2 ? 1 : 2), c = 0;
	(!n || n.biff >= 5) && (n.biff != 5 && (e.l += 2), c = e.read_shift(2), n.biff == 5 && (e.l += 2), e.l += 4);
	var l = _a(e, o, n);
	i & 32 && (l = Oi[l.charCodeAt(0)]);
	var u = r - e.l;
	n && n.biff == 2 && --u;
	var d = r == e.l || s === 0 || !(u > 0) ? [] : zd(e, u, n, s);
	return {
		chKey: a,
		Name: l,
		itab: c,
		rgce: d
	};
}
function To(e, t, n) {
	if (n.biff < 8 || !(n.biff > 8) && t == e[e.l] + +(e[e.l + 1] == 3) + 1) return Eo(e, t, n);
	for (var r = [], i = e.l + t, a = e.read_shift(n.biff > 8 ? 4 : 2); a-- !== 0;) r.push(ja(e, n.biff > 8 ? 12 : 6, n));
	if (e.l != i) throw Error("Bad ExternSheet: " + e.l + " != " + i);
	return r;
}
function Eo(e, t, n) {
	e[e.l + 1] == 3 && e[e.l]++;
	var r = ha(e, t, n);
	return r.charCodeAt(0) == 3 ? r.slice(1) : r;
}
function Do(e, t, n) {
	if (n.biff < 8) {
		e.l += t;
		return;
	}
	var r = e.read_shift(2), i = e.read_shift(2);
	return [_a(e, r, n), _a(e, i, n)];
}
function Oo(e, t, n) {
	var r = Fa(e, 6);
	e.l++;
	var i = e.read_shift(1);
	return t -= 8, [
		Bd(e, t, n),
		i,
		r
	];
}
function ko(e, t, n) {
	var r = Ia(e, 6);
	switch (n.biff) {
		case 2:
			e.l++, t -= 7;
			break;
		case 3:
		case 4:
			e.l += 2, t -= 8;
			break;
		default: e.l += 6, t -= 12;
	}
	return [r, Ld(e, t, n, r)];
}
function Ao(e) {
	return [
		e.read_shift(4) !== 0,
		e.read_shift(4) !== 0,
		e.read_shift(4)
	];
}
function jo(e, t, n) {
	var r = e.read_shift(2), i = e.read_shift(2), a = e.read_shift(2), o = e.read_shift(2), s = ya(e, 0, n);
	return [
		{
			r,
			c: i
		},
		s,
		o,
		a
	];
}
function Mo(e, t, n) {
	if (n && n.biff < 8) {
		var r = e.read_shift(2), i = e.read_shift(2);
		if (r == 65535 || r == -1) return;
		var a = e.read_shift(2), o = e.read_shift(Math.min(a, 2048), "cpstr");
		return [{
			r,
			c: i
		}, o];
	}
	return jo(e, t, n);
}
function No(e, t) {
	for (var n = [], r = e.read_shift(2); r--;) n.push(Pa(e, t));
	return n;
}
function Po(e, t, n) {
	if (n && n.biff < 8) return Io(e, t, n);
	var r = La(e, 22);
	return {
		cmo: r,
		ft: Ha(e, t - 22, r[1])
	};
}
var Fo = { 8: function(e, t) {
	var n = e.l + t;
	e.l += 10;
	var r = e.read_shift(2);
	e.l += 4, e.l += 2, e.l += 2, e.l += 2, e.l += 4;
	var i = e.read_shift(1);
	return e.l += i, e.l = n, { fmt: r };
} };
function Io(e, t, n) {
	e.l += 4;
	var r = e.read_shift(2), i = e.read_shift(2), a = e.read_shift(2);
	e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 2, e.l += 6, t -= 36;
	var o = [];
	return o.push((Fo[r] || mr)(e, t, n)), {
		cmo: [
			i,
			r,
			a
		],
		ft: o
	};
}
function Lo(e, t, n) {
	var r = e.l, i = "";
	try {
		e.l += 4;
		var a = (n.lastobj || { cmo: [0, 0] }).cmo[1];
		[
			0,
			5,
			7,
			11,
			12,
			14
		].indexOf(a) == -1 ? e.l += 6 : ba(e, 6, n);
		var o = e.read_shift(2);
		e.read_shift(2), fa(e, 2);
		var s = e.read_shift(2);
		e.l += s;
		for (var c = 1; c < e.lens.length - 1; ++c) {
			if (e.l - r != e.lens[c]) throw Error("TxO: bad continue record");
			var l = e[e.l], u = _a(e, e.lens[c + 1] - e.lens[c] - 1);
			if (i += u, i.length >= (l ? o : 2 * o)) break;
		}
		if (i.length !== o && i.length !== o * 2) throw Error("cchText: " + o + " != " + i.length);
		return e.l = r + t, { t: i };
	} catch {
		return e.l = r + t, { t: i };
	}
}
function Ro(e, t) {
	var n = Pa(e, 8);
	return e.l += 16, [n, Ta(e, t - 24)];
}
function zo(e, t) {
	e.read_shift(2);
	var n = Pa(e, 8), r = e.read_shift((t - 10) / 2, "dbcs-cont");
	return r = r.replace(M, ""), [n, r];
}
function Bo(e) {
	var t = [0, 0], n = e.read_shift(2);
	return t[0] = Si[n] || n, n = e.read_shift(2), t[1] = Si[n] || n, t;
}
function Vo(e) {
	for (var t = e.read_shift(2), n = []; t-- > 0;) n.push(Da(e, 8));
	return n;
}
function Ho(e) {
	for (var t = e.read_shift(2), n = []; t-- > 0;) n.push(Da(e, 8));
	return n;
}
function Uo(e) {
	e.l += 2;
	var t = {
		cxfs: 0,
		crc: 0
	};
	return t.cxfs = e.read_shift(2), t.crc = e.read_shift(4), t;
}
function Wo(e, t, n) {
	if (!n.cellStyles) return mr(e, t);
	var r = n && n.biff >= 12 ? 4 : 2, i = e.read_shift(r), a = e.read_shift(r), o = e.read_shift(r), s = e.read_shift(r), c = e.read_shift(2);
	r == 2 && (e.l += 2);
	var l = {
		s: i,
		e: a,
		w: o,
		ixfe: s,
		flags: c
	};
	return (n.biff >= 5 || !n.biff) && (l.level = c >> 8 & 7), l;
}
function Go(e, t) {
	var n = {};
	return t < 32 ? n : (e.l += 16, n.header = ti(e, 8), n.footer = ti(e, 8), e.l += 2, n);
}
function Ko(e, t, n) {
	var r = { area: !1 };
	if (n.biff != 5) return e.l += t, r;
	var i = e.read_shift(1);
	return e.l += 3, i & 16 && (r.area = !0), r;
}
var qo = Oa, Jo = pa, Yo = va;
function Xo(e) {
	var t = e.read_shift(2), n = e.read_shift(2), r = e.read_shift(4), i = {
		fmt: t,
		env: n,
		len: r,
		data: e.slice(e.l, e.l + r)
	};
	return e.l += r, i;
}
function Zo(e, t, n) {
	n.biffguess && n.biff == 5 && (n.biff = 2);
	var r = Oa(e, 7, n), i = ya(e, t - 7, n);
	return r.t = "str", r.val = i, r;
}
function Qo(e, t, n) {
	var r = Oa(e, 7, n), i = ti(e, 8);
	return r.t = "n", r.val = i, r;
}
function $o(e, t, n) {
	var r = Oa(e, 7, n), i = e.read_shift(2);
	return r.t = "n", r.val = i, r;
}
function es(e) {
	var t = e.read_shift(1);
	return t === 0 ? (e.l++, "") : e.read_shift(t, "sbcs-cont");
}
function ts(e, t, n) {
	var r = e.l + 7, i = Oa(e, 6, n);
	e.l = r;
	var a = ma(e, 2);
	return i.val = a, i.t = a === !0 || a === !1 ? "b" : "e", i;
}
function ns(e, t) {
	e.l += 6, e.l += 2, e.l += 1, e.l += 3, e.l += 1, e.l += t - 13;
}
function rs(e, t, n) {
	var r = e.l + t, i = Oa(e, 6, n), a = _a(e, e.read_shift(2), n);
	return e.l = r, i.t = "str", i.val = a, i;
}
function is(e) {
	var t = e.read_shift(4), n = e.read_shift(1), r = e.read_shift(n, "sbcs");
	return r.length === 0 && (r = "Sheet1"), {
		flags: t,
		name: r
	};
}
var as = [
	2,
	3,
	48,
	49,
	131,
	139,
	140,
	245
], os = /*#__PURE__*/ (function() {
	var e = {
		1: 437,
		2: 850,
		3: 1252,
		4: 1e4,
		100: 852,
		101: 866,
		102: 865,
		103: 861,
		104: 895,
		105: 620,
		106: 737,
		107: 857,
		120: 950,
		121: 949,
		122: 936,
		123: 932,
		124: 874,
		125: 1255,
		126: 1256,
		150: 10007,
		151: 10029,
		152: 10006,
		200: 1250,
		201: 1251,
		202: 1254,
		203: 1253,
		0: 20127,
		8: 865,
		9: 437,
		10: 850,
		11: 437,
		13: 437,
		14: 850,
		15: 437,
		16: 850,
		17: 437,
		18: 850,
		19: 932,
		20: 850,
		21: 437,
		22: 850,
		23: 865,
		24: 437,
		25: 437,
		26: 850,
		27: 437,
		28: 863,
		29: 850,
		31: 852,
		34: 852,
		35: 852,
		36: 860,
		37: 850,
		38: 866,
		55: 850,
		64: 852,
		77: 936,
		78: 949,
		79: 950,
		80: 874,
		87: 1252,
		88: 1252,
		89: 1252,
		108: 863,
		134: 737,
		135: 852,
		136: 857,
		204: 1257,
		255: 16969
	}, i = it({
		1: 437,
		2: 850,
		3: 1252,
		4: 1e4,
		100: 852,
		101: 866,
		102: 865,
		103: 861,
		104: 895,
		105: 620,
		106: 737,
		107: 857,
		120: 950,
		121: 949,
		122: 936,
		123: 932,
		124: 874,
		125: 1255,
		126: 1256,
		150: 10007,
		151: 10029,
		152: 10006,
		200: 1250,
		201: 1251,
		202: 1254,
		203: 1253,
		0: 20127
	});
	function a(t, n) {
		var i = [], a = E(1);
		switch (n.type) {
			case "base64":
				a = O(S(t));
				break;
			case "binary":
				a = O(t);
				break;
			case "buffer":
			case "array":
				a = t;
				break;
		}
		pr(a, 0);
		var o = a.read_shift(1), s = !!(o & 136), c = !1, l = !1;
		switch (o) {
			case 2: break;
			case 3: break;
			case 48:
				c = !0, s = !0;
				break;
			case 49:
				c = !0, s = !0;
				break;
			case 131: break;
			case 139: break;
			case 140:
				l = !0;
				break;
			case 245: break;
			default: throw Error("DBF Unsupported Version: " + o.toString(16));
		}
		var u = 0, d = 521;
		o == 2 && (u = a.read_shift(2)), a.l += 3, o != 2 && (u = a.read_shift(4)), u > 1048576 && (u = 1e6), o != 2 && (d = a.read_shift(2));
		var f = a.read_shift(2), p = n.codepage || 1252;
		o != 2 && (a.l += 16, a.read_shift(1), a[a.l] !== 0 && (p = e[a[a.l]]), a.l += 1, a.l += 2), l && (a.l += 36);
		for (var m = [], h = {}, g = Math.min(a.length, o == 2 ? 521 : d - 10 - (c ? 264 : 0)), _ = l ? 32 : 11; a.l < g && a[a.l] != 13;) switch (h = {}, h.name = (r === void 0 ? k(a.slice(a.l, a.l + _)) : r.utils.decode(p, a.slice(a.l, a.l + _))).replace(/[\u0000\r\n][\S\s]*$/g, ""), a.l += _, h.type = String.fromCharCode(a.read_shift(1)), o != 2 && !l && (h.offset = a.read_shift(4)), h.len = a.read_shift(1), o == 2 && (h.offset = a.read_shift(2)), h.dec = a.read_shift(1), h.name.length && m.push(h), o != 2 && (a.l += l ? 13 : 14), h.type) {
			case "B":
				(!c || h.len != 8) && n.WTF && console.log("Skipping " + h.name + ":" + h.type);
				break;
			case "G":
			case "P":
				n.WTF && console.log("Skipping " + h.name + ":" + h.type);
				break;
			case "+":
			case "0":
			case "@":
			case "C":
			case "D":
			case "F":
			case "I":
			case "L":
			case "M":
			case "N":
			case "O":
			case "T":
			case "Y": break;
			default: throw Error("Unknown Field Type: " + h.type);
		}
		if (a[a.l] !== 13 && (a.l = d - 1), a.read_shift(1) !== 13) throw Error("DBF Terminator not found " + a.l + " " + a[a.l]);
		a.l = d;
		var v = 0, y = 0;
		for (i[0] = [], y = 0; y != m.length; ++y) i[0][y] = m[y].name;
		for (; u-- > 0;) {
			if (a[a.l] === 42) {
				a.l += f;
				continue;
			}
			for (++a.l, i[++v] = [], y = 0, y = 0; y != m.length; ++y) {
				var b = a.slice(a.l, a.l + m[y].len);
				a.l += m[y].len, pr(b, 0);
				var x = r === void 0 ? k(b) : r.utils.decode(p, b);
				switch (m[y].type) {
					case "C":
						x.trim().length && (i[v][y] = x.replace(/([^\s])\s+$/, "$1"));
						break;
					case "D":
						x.length === 8 ? (i[v][y] = new Date(Date.UTC(+x.slice(0, 4), x.slice(4, 6) - 1, +x.slice(6, 8), 0, 0, 0, 0)), n && n.UTC || (i[v][y] = Ot(i[v][y]))) : i[v][y] = x;
						break;
					case "F":
						i[v][y] = parseFloat(x.trim());
						break;
					case "+":
					case "I":
						i[v][y] = l ? b.read_shift(-4, "i") ^ 2147483648 : b.read_shift(4, "i");
						break;
					case "L":
						switch (x.trim().toUpperCase()) {
							case "Y":
							case "T":
								i[v][y] = !0;
								break;
							case "N":
							case "F":
								i[v][y] = !1;
								break;
							case "":
							case "\0":
							case "?": break;
							default: throw Error("DBF Unrecognized L:|" + x + "|");
						}
						break;
					case "M":
						if (!s) throw Error("DBF Unexpected MEMO for type " + o.toString(16));
						i[v][y] = "##MEMO##" + (l ? parseInt(x.trim(), 10) : b.read_shift(4));
						break;
					case "N":
						x = x.replace(/\u0000/g, "").trim(), x && x != "." && (i[v][y] = +x || 0);
						break;
					case "@":
						i[v][y] = /* @__PURE__ */ new Date(b.read_shift(-8, "f") - 621356832e5);
						break;
					case "T":
						var C = b.read_shift(4), w = b.read_shift(4);
						if (C == 0 && w == 0) break;
						i[v][y] = new Date((C - 2440588) * 864e5 + w), n && n.UTC || (i[v][y] = Ot(i[v][y]));
						break;
					case "Y":
						i[v][y] = b.read_shift(4, "i") / 1e4 + b.read_shift(4, "i") / 1e4 * 2 ** 32;
						break;
					case "O":
						i[v][y] = -b.read_shift(-8, "f");
						break;
					case "B": if (c && m[y].len == 8) {
						i[v][y] = b.read_shift(8, "f");
						break;
					}
					case "G":
					case "P":
						b.l += m[y].len;
						break;
					case "0": if (m[y].name === "_NullFlags") break;
					default: throw Error("DBF Unsupported data type " + m[y].type);
				}
			}
		}
		if (o != 2 && a.l < a.length && a[a.l++] != 26) throw Error("DBF EOF Marker missing " + (a.l - 1) + " of " + a.length + " " + a[a.l - 1].toString(16));
		return n && n.sheetRows && (i = i.slice(0, n.sheetRows)), n.DBF = m, i;
	}
	function o(e, t) {
		var n = t || {};
		n.dateNF || (n.dateNF = "yyyymmdd");
		var r = Br(a(e, n), n);
		return r["!cols"] = n.DBF.map(function(e) {
			return {
				wch: e.len,
				DBF: e
			};
		}), delete n.DBF, r;
	}
	function s(e, t) {
		try {
			var n = Lr(o(e, t), t);
			return n.bookType = "dbf", n;
		} catch (e) {
			if (t && t.WTF) throw e;
		}
		return {
			SheetNames: [],
			Sheets: {}
		};
	}
	var l = {
		B: 8,
		C: 250,
		L: 1,
		D: 8,
		"?": 0,
		"": 0
	};
	function u(a, o) {
		if (!a["!ref"]) throw Error("Cannot export empty sheet to DBF");
		var s = o || {}, u = t;
		if (+s.codepage >= 0 && c(+s.codepage), s.type == "string") throw Error("Cannot write DBF to JS string");
		var d = _r(), f = lg(a, {
			header: 1,
			raw: !0,
			cellDates: !0
		}), p = f[0], m = f.slice(1), h = a["!cols"] || [], g = 0, _ = 0, v = 0, y = 1;
		for (g = 0; g < p.length; ++g) {
			if (((h[g] || {}).DBF || {}).name) {
				p[g] = h[g].DBF.name, ++v;
				continue;
			}
			if (p[g] != null) {
				if (++v, typeof p[g] == "number" && (p[g] = p[g].toString(10)), typeof p[g] != "string") throw Error("DBF Invalid column name " + p[g] + " |" + typeof p[g] + "|");
				if (p.indexOf(p[g]) !== g) {
					for (_ = 0; _ < 1024; ++_) if (p.indexOf(p[g] + "_" + _) == -1) {
						p[g] += "_" + _;
						break;
					}
				}
			}
		}
		var b = Pr(a["!ref"]), x = [], S = [], C = [];
		for (g = 0; g <= b.e.c - b.s.c; ++g) {
			var w = "", T = "", E = 0, D = [];
			for (_ = 0; _ < m.length; ++_) m[_][g] != null && D.push(m[_][g]);
			if (D.length == 0 || p[g] == null) {
				x[g] = "?";
				continue;
			}
			for (_ = 0; _ < D.length; ++_) {
				switch (typeof D[_]) {
					case "number":
						T = "B";
						break;
					case "string":
						T = "C";
						break;
					case "boolean":
						T = "L";
						break;
					case "object":
						T = D[_] instanceof Date ? "D" : "C";
						break;
					default: T = "C";
				}
				E = Math.max(E, (r !== void 0 && typeof D[_] == "string" ? r.utils.encode(n, D[_]) : String(D[_])).length), w = w && w != T ? "C" : T;
			}
			E > 250 && (E = 250), T = ((h[g] || {}).DBF || {}).type, T == "C" && h[g].DBF.len > E && (E = h[g].DBF.len), w == "B" && T == "N" && (w = "N", C[g] = h[g].DBF.dec, E = h[g].DBF.len), S[g] = w == "C" || T == "N" ? E : l[w] || 0, y += S[g], x[g] = w;
		}
		var O = d.next(32);
		for (O.write_shift(4, 318902576), O.write_shift(4, m.length), O.write_shift(2, 296 + 32 * v), O.write_shift(2, y), g = 0; g < 4; ++g) O.write_shift(4, 0);
		var k = +i[t] || 3;
		for (O.write_shift(4, 0 | k << 8), e[k] != +s.codepage && (s.codepage && console.error("DBF Unsupported codepage " + t + ", using 1252"), t = 1252), g = 0, _ = 0; g < p.length; ++g) if (p[g] != null) {
			var A = d.next(32), j = (p[g].slice(-10) + "\0\0\0\0\0\0\0\0\0\0\0").slice(0, 11);
			A.write_shift(1, j, "sbcs"), A.write_shift(1, x[g] == "?" ? "C" : x[g], "sbcs"), A.write_shift(4, _), A.write_shift(1, S[g] || l[x[g]] || 0), A.write_shift(1, C[g] || 0), A.write_shift(1, 2), A.write_shift(4, 0), A.write_shift(1, 0), A.write_shift(4, 0), A.write_shift(4, 0), _ += S[g] || l[x[g]] || 0;
		}
		var ee = d.next(264);
		for (ee.write_shift(4, 13), g = 0; g < 65; ++g) ee.write_shift(4, 0);
		for (g = 0; g < m.length; ++g) {
			var M = d.next(y);
			for (M.write_shift(1, 0), _ = 0; _ < p.length; ++_) if (p[_] != null) switch (x[_]) {
				case "L":
					M.write_shift(1, m[g][_] == null ? 63 : m[g][_] ? 84 : 70);
					break;
				case "B":
					M.write_shift(8, m[g][_] || 0, "f");
					break;
				case "N":
					var N = "0";
					for (typeof m[g][_] == "number" && (N = m[g][_].toFixed(C[_] || 0)), N.length > S[_] && (N = N.slice(0, S[_])), v = 0; v < S[_] - N.length; ++v) M.write_shift(1, 32);
					M.write_shift(1, N, "sbcs");
					break;
				case "D":
					m[g][_] ? (M.write_shift(4, ("0000" + m[g][_].getFullYear()).slice(-4), "sbcs"), M.write_shift(2, ("00" + (m[g][_].getMonth() + 1)).slice(-2), "sbcs"), M.write_shift(2, ("00" + m[g][_].getDate()).slice(-2), "sbcs")) : M.write_shift(8, "00000000", "sbcs");
					break;
				case "C":
					var P = M.l, F = String(m[g][_] == null ? "" : m[g][_]).slice(0, S[_]);
					for (M.write_shift(1, F, "cpstr"), P += S[_] - M.l, v = 0; v < P; ++v) M.write_shift(1, 32);
					break;
			}
		}
		return t = u, d.next(1).write_shift(1, 26), d.end();
	}
	return {
		to_workbook: s,
		to_sheet: o,
		from_sheet: u
	};
})(), ss = /*#__PURE__*/ (function() {
	var e = {
		AA: "À",
		BA: "Á",
		CA: "Â",
		DA: 195,
		HA: "Ä",
		JA: 197,
		AE: "È",
		BE: "É",
		CE: "Ê",
		HE: "Ë",
		AI: "Ì",
		BI: "Í",
		CI: "Î",
		HI: "Ï",
		AO: "Ò",
		BO: "Ó",
		CO: "Ô",
		DO: 213,
		HO: "Ö",
		AU: "Ù",
		BU: "Ú",
		CU: "Û",
		HU: "Ü",
		Aa: "à",
		Ba: "á",
		Ca: "â",
		Da: 227,
		Ha: "ä",
		Ja: 229,
		Ae: "è",
		Be: "é",
		Ce: "ê",
		He: "ë",
		Ai: "ì",
		Bi: "í",
		Ci: "î",
		Hi: "ï",
		Ao: "ò",
		Bo: "ó",
		Co: "ô",
		Do: 245,
		Ho: "ö",
		Au: "ù",
		Bu: "ú",
		Cu: "û",
		Hu: "ü",
		KC: "Ç",
		Kc: "ç",
		q: "æ",
		z: "œ",
		a: "Æ",
		j: "Œ",
		DN: 209,
		Dn: 241,
		Hy: 255,
		S: 169,
		c: 170,
		R: 174,
		"B ": 180,
		0: 176,
		1: 177,
		2: 178,
		3: 179,
		5: 181,
		6: 182,
		7: 183,
		Q: 185,
		k: 186,
		b: 208,
		i: 216,
		l: 222,
		s: 240,
		y: 248,
		"!": 161,
		"\"": 162,
		"#": 163,
		"(": 164,
		"%": 165,
		"'": 167,
		"H ": 168,
		"+": 171,
		";": 187,
		"<": 188,
		"=": 189,
		">": 190,
		"?": 191,
		"{": 223
	}, t = RegExp("\x1BN(" + rt(e).join("|").replace(/\|\|\|/, "|\\||").replace(/([?()+])/g, "\\$1").replace("{", "\\{") + "|\\|)", "gm");
	try {
		t = RegExp("\x1BN(" + rt(e).join("|").replace(/\|\|\|/, "|\\||").replace(/([?()+])/g, "\\$1") + "|\\|)", "gm");
	} catch {}
	var n = function(t, n) {
		var r = e[n];
		return typeof r == "number" ? g(r) : r;
	}, i = function(e, t, n) {
		var r = t.charCodeAt(0) - 32 << 4 | n.charCodeAt(0) - 48;
		return r == 59 ? e : g(r);
	};
	e["|"] = 254;
	var a = function(e) {
		return e.replace(/\n/g, "\x1B :").replace(/\r/g, "\x1B =");
	};
	function o(e, t) {
		switch (t.type) {
			case "base64": return s(S(e), t);
			case "binary": return s(e, t);
			case "buffer": return s(C && Buffer.isBuffer(e) ? e.toString("binary") : k(e), t);
			case "array": return s(ht(e), t);
		}
		throw Error("Unrecognized type " + t.type);
	}
	function s(e, a) {
		var o = e.split(/[\n\r]+/), s = -1, l = -1, u = 0, d = 0, f = [], p = [], m = null, h = {}, g = [], _ = [], v = [], y = 0, b, x = { Workbook: {
			WBProps: {},
			Names: []
		} };
		for (+a.codepage >= 0 && c(+a.codepage); u !== o.length; ++u) {
			y = 0;
			var S = o[u].trim().replace(/\x1B([\x20-\x2F])([\x30-\x3F])/g, i).replace(t, n), C = S.replace(/;;/g, "\0").split(";").map(function(e) {
				return e.replace(/\u0000/g, ";");
			}), w = C[0], T;
			if (S.length > 0) switch (w) {
				case "ID": break;
				case "E": break;
				case "B": break;
				case "O":
					for (d = 1; d < C.length; ++d) switch (C[d].charAt(0)) {
						case "V":
							var E = parseInt(C[d].slice(1), 10);
							E >= 1 && E <= 4 && (x.Workbook.WBProps.date1904 = !0);
							break;
					}
					break;
				case "W": break;
				case "P":
					switch (C[1].charAt(0)) {
						case "P":
							p.push(S.slice(3).replace(/;;/g, ";"));
							break;
					}
					break;
				case "NN":
					var D = { Sheet: 0 };
					for (d = 1; d < C.length; ++d) switch (C[d].charAt(0)) {
						case "N":
							D.Name = C[d].slice(1);
							break;
						case "E":
							D.Ref = (a && a.sheet || "Sheet1") + "!" + tu(C[d].slice(1));
							break;
					}
					x.Workbook.Names.push(D);
					break;
				case "C":
					var O = !1, k = !1, A = !1, j = !1, ee = -1, M = -1, N = "", P = "z", F = "";
					for (d = 1; d < C.length; ++d) switch (C[d].charAt(0)) {
						case "A":
							F = C[d].slice(1);
							break;
						case "X":
							l = parseInt(C[d].slice(1), 10) - 1, k = !0;
							break;
						case "Y":
							for (s = parseInt(C[d].slice(1), 10) - 1, k || (l = 0), b = f.length; b <= s; ++b) f[b] = [];
							break;
						case "K":
							T = C[d].slice(1), T.charAt(0) === "\"" ? (T = T.slice(1, T.length - 1), P = "s") : T === "TRUE" || T === "FALSE" ? (T = T === "TRUE", P = "b") : T.charAt(0) == "#" && Di[T] != null ? (P = "e", T = Di[T]) : isNaN(vt(T)) || (T = vt(T), P = "n", m !== null && ze(m) && a.cellDates && (T = lt(x.Workbook.WBProps.date1904 ? T + 1462 : T), P = typeof T == "number" ? "n" : "d")), r !== void 0 && typeof T == "string" && (a || {}).type != "string" && (a || {}).codepage && (T = r.utils.decode(a.codepage, T)), O = !0;
							break;
						case "E":
							j = !0, N = tu(C[d].slice(1), {
								r: s,
								c: l
							});
							break;
						case "S":
							A = !0;
							break;
						case "G": break;
						case "R":
							ee = parseInt(C[d].slice(1), 10) - 1;
							break;
						case "C":
							M = parseInt(C[d].slice(1), 10) - 1;
							break;
						default: if (a && a.WTF) throw Error("SYLK bad record " + S);
					}
					if (O && (f[s][l] ? (f[s][l].t = P, f[s][l].v = T) : f[s][l] = {
						t: P,
						v: T
					}, m && (f[s][l].z = m), a.cellText !== !1 && m && (f[s][l].w = We(f[s][l].z, f[s][l].v, { date1904: x.Workbook.WBProps.date1904 })), m = null), A) {
						if (j) throw Error("SYLK shared formula cannot have own formula");
						var I = ee > -1 && f[ee][M];
						if (!I || !I[1]) throw Error("SYLK shared formula cannot find base");
						N = iu(I[1], {
							r: s - ee,
							c: l - M
						});
					}
					N && (f[s][l] ? f[s][l].f = N : f[s][l] = {
						t: "n",
						f: N
					}), F && (f[s][l] || (f[s][l] = { t: "z" }), f[s][l].c = [{
						a: "SheetJSYLK",
						t: F
					}]);
					break;
				case "F":
					var L = 0;
					for (d = 1; d < C.length; ++d) switch (C[d].charAt(0)) {
						case "X":
							l = parseInt(C[d].slice(1), 10) - 1, ++L;
							break;
						case "Y":
							for (s = parseInt(C[d].slice(1), 10) - 1, b = f.length; b <= s; ++b) f[b] = [];
							break;
						case "M":
							y = parseInt(C[d].slice(1), 10) / 20;
							break;
						case "F": break;
						case "G": break;
						case "P":
							m = p[parseInt(C[d].slice(1), 10)];
							break;
						case "S": break;
						case "D": break;
						case "N": break;
						case "W":
							for (v = C[d].slice(1).split(" "), b = parseInt(v[0], 10); b <= parseInt(v[1], 10); ++b) y = parseInt(v[2], 10), _[b - 1] = y === 0 ? { hidden: !0 } : { wch: y };
							break;
						case "C":
							l = parseInt(C[d].slice(1), 10) - 1, _[l] || (_[l] = {});
							break;
						case "R":
							s = parseInt(C[d].slice(1), 10) - 1, g[s] || (g[s] = {}), y > 0 ? (g[s].hpt = y, g[s].hpx = Ic(y)) : y === 0 && (g[s].hidden = !0);
							break;
						default: if (a && a.WTF) throw Error("SYLK bad record " + S);
					}
					L < 1 && (m = null);
					break;
				default: if (a && a.WTF) throw Error("SYLK bad record " + S);
			}
		}
		return g.length > 0 && (h["!rows"] = g), _.length > 0 && (h["!cols"] = _), _.forEach(function(e) {
			mc(e);
		}), a && a.sheetRows && (f = f.slice(0, a.sheetRows)), [
			f,
			h,
			x
		];
	}
	function l(e, t) {
		var n = o(e, t), r = n[0], i = n[1], a = n[2], s = gt(t);
		s.date1904 = (((a || {}).Workbook || {}).WBProps || {}).date1904;
		var c = Br(r, s);
		rt(i).forEach(function(e) {
			c[e] = i[e];
		});
		var l = Lr(c, t);
		return rt(a).forEach(function(e) {
			l[e] = a[e];
		}), l.bookType = "sylk", l;
	}
	function u(e, t, n, r, i, a) {
		var o = "C;Y" + (n + 1) + ";X" + (r + 1) + ";K";
		switch (e.t) {
			case "n":
				o += isFinite(e.v) ? e.v || 0 : Ei[isNaN(e.v) ? 36 : 7], e.f && !e.F && (o += ";E" + ru(e.f, {
					r: n,
					c: r
				}));
				break;
			case "b":
				o += e.v ? "TRUE" : "FALSE";
				break;
			case "e":
				o += e.w || Ei[e.v] || e.v;
				break;
			case "d":
				o += ct(mt(e.v, a), a);
				break;
			case "s":
				o += "\"" + (e.v == null ? "" : String(e.v)).replace(/"/g, "").replace(/;/g, ";;") + "\"";
				break;
		}
		return o;
	}
	function d(e, t, n) {
		var r = "C;Y" + (t + 1) + ";X" + (n + 1) + ";A";
		return r += a(e.map(function(e) {
			return e.t;
		}).join("")), r;
	}
	function f(e, t) {
		t.forEach(function(t, n) {
			var r = "F;W" + (n + 1) + " " + (n + 1) + " ";
			t.hidden ? r += "0" : (typeof t.width == "number" && !t.wpx && (t.wpx = lc(t.width)), typeof t.wpx == "number" && !t.wch && (t.wch = uc(t.wpx)), typeof t.wch == "number" && (r += Math.round(t.wch))), r.charAt(r.length - 1) != " " && e.push(r);
		});
	}
	function p(e, t) {
		t.forEach(function(t, n) {
			var r = "F;";
			t.hidden ? r += "M0;" : t.hpt ? r += "M" + 20 * t.hpt + ";" : t.hpx && (r += "M" + 20 * Fc(t.hpx) + ";"), r.length > 2 && e.push(r + "R" + (n + 1));
		});
	}
	function m(e, t, n) {
		t || (t = {}), t._formats = ["General"];
		var r = ["ID;PSheetJS;N;E"], i = [], a = Pr(e["!ref"] || "A1"), o, s = e["!data"] != null, c = "\r\n", l = (((n || {}).Workbook || {}).WBProps || {}).date1904, m = "General";
		r.push("P;PGeneral");
		var h = a.s.r, g = a.s.c, _ = [];
		if (e["!ref"]) {
			for (h = a.s.r; h <= a.e.r; ++h) if (!(s && !e["!data"][h])) {
				for (_ = [], g = a.s.c; g <= a.e.c; ++g) o = s ? e["!data"][h][g] : e[Dr(g) + Cr(h)], !(!o || !o.c) && _.push(d(o.c, h, g));
				_.length && i.push(_.join(c));
			}
		}
		if (e["!ref"]) {
			for (h = a.s.r; h <= a.e.r; ++h) if (!(s && !e["!data"][h])) {
				for (_ = [], g = a.s.c; g <= a.e.c; ++g) if (o = s ? e["!data"][h][g] : e[Dr(g) + Cr(h)], !(!o || o.v == null && (!o.f || o.F))) {
					if ((o.z || (o.t == "d" ? V[14] : "General")) != m) {
						var v = t._formats.indexOf(o.z);
						v == -1 && (t._formats.push(o.z), v = t._formats.length - 1, r.push("P;P" + o.z.replace(/;/g, ";;"))), _.push("F;P" + v + ";Y" + (h + 1) + ";X" + (g + 1));
					}
					_.push(u(o, e, h, g, t, l));
				}
				i.push(_.join(c));
			}
		}
		return r.push("F;P0;DG0G8;M255"), e["!cols"] && f(r, e["!cols"]), e["!rows"] && p(r, e["!rows"]), e["!ref"] && r.push("B;Y" + (a.e.r - a.s.r + 1) + ";X" + (a.e.c - a.s.c + 1) + ";D" + [
			a.s.c,
			a.s.r,
			a.e.c,
			a.e.r
		].join(" ")), r.push("O;L;D;B" + (l ? ";V4" : "") + ";K47;G100 0.001"), delete t._formats, r.join(c) + c + i.join(c) + c + "E" + c;
	}
	return {
		to_workbook: l,
		from_sheet: m
	};
})(), cs = /*#__PURE__*/ (function() {
	function e(e, n) {
		switch (n.type) {
			case "base64": return t(S(e), n);
			case "binary": return t(e, n);
			case "buffer": return t(C && Buffer.isBuffer(e) ? e.toString("binary") : k(e), n);
			case "array": return t(ht(e), n);
		}
		throw Error("Unrecognized type " + n.type);
	}
	function t(e, t) {
		for (var n = e.split("\n"), r = -1, i = -1, a = 0, o = []; a !== n.length; ++a) {
			if (n[a].trim() === "BOT") {
				o[++r] = [], i = 0;
				continue;
			}
			if (!(r < 0)) {
				var s = n[a].trim().split(","), c = s[0], l = s[1];
				++a;
				for (var u = n[a] || ""; (u.match(/["]/g) || []).length & 1 && a < n.length - 1;) u += "\n" + n[++a];
				switch (u = u.trim(), +c) {
					case -1:
						if (u === "BOT") {
							o[++r] = [], i = 0;
							continue;
						} else if (u !== "EOD") throw Error("Unrecognized DIF special command " + u);
						break;
					case 0:
						u === "TRUE" ? o[r][i] = !0 : u === "FALSE" ? o[r][i] = !1 : isNaN(vt(l)) ? isNaN(Et(l).getDate()) ? o[r][i] = l : (o[r][i] = mt(l), t && t.UTC || (o[r][i] = Ot(o[r][i]))) : o[r][i] = vt(l), ++i;
						break;
					case 1:
						u = u.slice(1, u.length - 1), u = u.replace(/""/g, "\""), v && u && u.match(/^=".*"$/) && (u = u.slice(2, -1)), o[r][i++] = u === "" ? null : u;
						break;
				}
				if (u === "EOD") break;
			}
		}
		return t && t.sheetRows && (o = o.slice(0, t.sheetRows)), o;
	}
	function n(t, n) {
		return Br(e(t, n), n);
	}
	function r(e, t) {
		var r = Lr(n(e, t), t);
		return r.bookType = "dif", r;
	}
	function i(e, t) {
		return "0," + String(e) + "\r\n" + t;
	}
	function a(e) {
		return "1,0\r\n\"" + e.replace(/"/g, "\"\"") + "\"";
	}
	function o(e) {
		var t = v;
		if (!e["!ref"]) throw Error("Cannot export empty sheet to DIF");
		for (var n = Pr(e["!ref"]), r = e["!data"] != null, o = [
			"TABLE\r\n0,1\r\n\"sheetjs\"\r\n",
			"VECTORS\r\n0," + (n.e.r - n.s.r + 1) + "\r\n\"\"\r\n",
			"TUPLES\r\n0," + (n.e.c - n.s.c + 1) + "\r\n\"\"\r\n",
			"DATA\r\n0,0\r\n\"\"\r\n"
		], s = n.s.r; s <= n.e.r; ++s) {
			for (var c = r ? e["!data"][s] : [], l = "-1,0\r\nBOT\r\n", u = n.s.c; u <= n.e.c; ++u) {
				var d = r ? c && c[u] : e[Y({
					r: s,
					c: u
				})];
				if (d == null) {
					l += "1,0\r\n\"\"\r\n";
					continue;
				}
				switch (d.t) {
					case "n":
						t ? d.w == null ? d.v == null ? d.f != null && !d.F ? l += a("=" + d.f) : l += "1,0\r\n\"\"" : l += i(d.v, "V") : l += "0," + d.w + "\r\nV" : d.v == null ? l += "1,0\r\n\"\"" : l += i(d.v, "V");
						break;
					case "b":
						l += d.v ? i(1, "TRUE") : i(0, "FALSE");
						break;
					case "s":
						l += a(!t || isNaN(+d.v) ? d.v : "=\"" + d.v + "\"");
						break;
					case "d":
						d.w || (d.w = We(d.z || V[14], ct(mt(d.v)))), t ? l += i(d.w, "V") : l += a(d.w);
						break;
					default: l += "1,0\r\n\"\"";
				}
				l += "\r\n";
			}
			o.push(l);
		}
		return o.join("") + "-1,0\r\nEOD";
	}
	return {
		to_workbook: r,
		to_sheet: n,
		from_sheet: o
	};
})(), ls = /*#__PURE__*/ (function() {
	function e(e) {
		return e.replace(/\\b/g, "\\").replace(/\\c/g, ":").replace(/\\n/g, "\n");
	}
	function t(e) {
		return e.replace(/\\/g, "\\b").replace(/:/g, "\\c").replace(/\n/g, "\\n");
	}
	function n(t, n) {
		for (var r = t.split("\n"), i = -1, a = -1, o = 0, s = []; o !== r.length; ++o) {
			var c = r[o].trim().split(":");
			if (c[0] === "cell") {
				var l = jr(c[1]);
				if (s.length <= l.r) for (i = s.length; i <= l.r; ++i) s[i] || (s[i] = []);
				switch (i = l.r, a = l.c, c[2]) {
					case "t":
						s[i][a] = e(c[3]);
						break;
					case "v":
						s[i][a] = +c[3];
						break;
					case "vtf": var u = c[c.length - 1];
					case "vtc":
						switch (c[3]) {
							case "nl":
								s[i][a] = !!+c[4];
								break;
							default:
								s[i][a] = c[c.length - 1].charAt(0) == "#" ? {
									t: "e",
									v: Di[c[c.length - 1]]
								} : +c[4];
								break;
						}
						c[2] == "vtf" && (s[i][a] = [s[i][a], u]);
				}
			}
		}
		return n && n.sheetRows && (s = s.slice(0, n.sheetRows)), s;
	}
	function r(e, t) {
		return Br(n(e, t), t);
	}
	function i(e, t) {
		return Lr(r(e, t), t);
	}
	var a = [
		"socialcalc:version:1.5",
		"MIME-Version: 1.0",
		"Content-Type: multipart/mixed; boundary=SocialCalcSpreadsheetControlSave"
	].join("\n"), o = ["--SocialCalcSpreadsheetControlSave", "Content-type: text/plain; charset=UTF-8"].join("\n") + "\n", s = ["# SocialCalc Spreadsheet Control Save", "part:sheet"].join("\n"), c = "--SocialCalcSpreadsheetControlSave--";
	function l(e) {
		if (!e || !e["!ref"]) return "";
		for (var n = [], r = [], i, a = "", o = Mr(e["!ref"]), s = e["!data"] != null, c = o.s.r; c <= o.e.r; ++c) for (var l = o.s.c; l <= o.e.c; ++l) if (a = Y({
			r: c,
			c: l
		}), i = s ? (e["!data"][c] || [])[l] : e[a], !(!i || i.v == null || i.t === "z")) {
			switch (r = [
				"cell",
				a,
				"t"
			], i.t) {
				case "s":
					r.push(t(i.v));
					break;
				case "b":
					r[2] = "vt" + (i.f ? "f" : "c"), r[3] = "nl", r[4] = i.v ? "1" : "0", r[5] = t(i.f || (i.v ? "TRUE" : "FALSE"));
					break;
				case "d":
					var u = ct(mt(i.v));
					r[2] = "vtc", r[3] = "nd", r[4] = "" + u, r[5] = i.w || We(i.z || V[14], u);
					break;
				case "n":
					isFinite(i.v) ? i.f ? (r[2] = "vtf", r[3] = "n", r[4] = i.v, r[5] = t(i.f)) : (r[2] = "v", r[3] = i.v) : (r[2] = "vt" + (i.f ? "f" : "c"), r[3] = "e" + Ei[isNaN(i.v) ? 36 : 7], r[4] = "0", r[5] = i.f || r[3].slice(1), r[6] = "e", r[7] = r[3].slice(1));
					break;
				case "e": continue;
			}
			n.push(r.join(":"));
		}
		return n.push("sheet:c:" + (o.e.c - o.s.c + 1) + ":r:" + (o.e.r - o.s.r + 1) + ":tvf:1"), n.push("valueformat:1:text-wiki"), n.join("\n");
	}
	function u(e) {
		return [
			a,
			o,
			s,
			o,
			l(e),
			c
		].join("\n");
	}
	return {
		to_workbook: i,
		to_sheet: r,
		from_sheet: u
	};
})(), us = /*#__PURE__*/ (function() {
	function e(e, t, n, r, i) {
		i.raw ? t[n][r] = e : e === "" || (e === "TRUE" ? t[n][r] = !0 : e === "FALSE" ? t[n][r] = !1 : isNaN(vt(e)) ? isNaN(Et(e).getDate()) ? e.charCodeAt(0) == 35 && Di[e] != null ? t[n][r] = {
			t: "e",
			v: Di[e],
			w: e
		} : t[n][r] = e : t[n][r] = mt(e) : t[n][r] = vt(e));
	}
	function t(t, n) {
		var r = n || {}, i = [];
		if (!t || t.length === 0) return i;
		for (var a = t.split(/[\r\n]/), o = a.length - 1; o >= 0 && a[o].length === 0;) --o;
		for (var s = 10, c = 0, l = 0; l <= o; ++l) c = a[l].indexOf(" "), c == -1 ? c = a[l].length : c++, s = Math.max(s, c);
		for (l = 0; l <= o; ++l) {
			i[l] = [];
			var u = 0;
			for (e(a[l].slice(0, s).trim(), i, l, u, r), u = 1; u <= (a[l].length - s) / 10 + 1; ++u) e(a[l].slice(s + (u - 1) * 10, s + u * 10).trim(), i, l, u, r);
		}
		return r.sheetRows && (i = i.slice(0, r.sheetRows)), i;
	}
	var n = {
		44: ",",
		9: "	",
		59: ";",
		124: "|"
	}, i = {
		44: 3,
		9: 2,
		59: 1,
		124: 0
	};
	function a(e) {
		for (var t = {}, r = !1, a = 0, o = 0; a < e.length; ++a) (o = e.charCodeAt(a)) == 34 ? r = !r : !r && o in n && (t[o] = (t[o] || 0) + 1);
		for (a in o = [], t) Object.prototype.hasOwnProperty.call(t, a) && o.push([t[a], a]);
		if (!o.length) for (a in t = i, t) Object.prototype.hasOwnProperty.call(t, a) && o.push([t[a], a]);
		return o.sort(function(e, t) {
			return e[0] - t[0] || i[e[1]] - i[t[1]];
		}), n[o.pop()[1]] || 44;
	}
	function o(e, t) {
		var n = t || {}, r = "";
		_ != null && n.dense == null && (n.dense = _);
		var i = {};
		n.dense && (i["!data"] = []);
		var o = {
			s: {
				c: 0,
				r: 0
			},
			e: {
				c: 0,
				r: 0
			}
		};
		e.slice(0, 4) == "sep=" ? e.charCodeAt(5) == 13 && e.charCodeAt(6) == 10 ? (r = e.charAt(4), e = e.slice(7)) : e.charCodeAt(5) == 13 || e.charCodeAt(5) == 10 ? (r = e.charAt(4), e = e.slice(6)) : r = a(e.slice(0, 1024)) : r = n && n.FS ? n.FS : a(e.slice(0, 1024));
		var s = 0, c = 0, l = 0, u = 0, d = 0, f = r.charCodeAt(0), p = !1, m = 0, h = e.charCodeAt(0), g = n.dateNF == null ? null : Ye(n.dateNF);
		function v() {
			var t = e.slice(u, d);
			t.slice(-1) == "\r" && (t = t.slice(0, -1));
			var r = {};
			if (t.charAt(0) == "\"" && t.charAt(t.length - 1) == "\"" && (t = t.slice(1, -1).replace(/""/g, "\"")), n.cellText !== !1 && (r.w = t), t.length === 0 ? r.t = "z" : n.raw || t.trim().length === 0 ? (r.t = "s", r.v = t) : t.charCodeAt(0) == 61 ? t.charCodeAt(1) == 34 && t.charCodeAt(t.length - 1) == 34 ? (r.t = "s", r.v = t.slice(2, -1).replace(/""/g, "\"")) : ou(t) ? (r.t = "s", r.f = t.slice(1), r.v = t) : (r.t = "s", r.v = t) : t == "TRUE" ? (r.t = "b", r.v = !0) : t == "FALSE" ? (r.t = "b", r.v = !1) : isNaN(l = vt(t)) ? !isNaN((l = Et(t)).getDate()) || g && t.match(g) ? (r.z = n.dateNF || V[14], g && t.match(g) ? (l = mt(Xe(t, n.dateNF, t.match(g) || [])), n && n.UTC === !1 && (l = Ot(l))) : n && n.UTC === !1 ? l = Ot(l) : n.cellText !== !1 && n.dateNF && (r.w = We(r.z, l)), n.cellDates ? (r.t = "d", r.v = l) : (r.t = "n", r.v = ct(l)), n.cellNF || delete r.z) : t.charCodeAt(0) == 35 && Di[t] != null ? (r.t = "e", r.w = t, r.v = Di[t]) : (r.t = "s", r.v = t) : (r.t = "n", r.v = l), r.t == "z" || (n.dense ? (i["!data"][s] || (i["!data"][s] = []), i["!data"][s][c] = r) : i[Y({
				c,
				r: s
			})] = r), u = d + 1, h = e.charCodeAt(u), o.e.c < c && (o.e.c = c), o.e.r < s && (o.e.r = s), m == f) ++c;
			else if (c = 0, ++s, n.sheetRows && n.sheetRows <= s) return !0;
		}
		outer: for (; d < e.length; ++d) switch (m = e.charCodeAt(d)) {
			case 34:
				h === 34 && (p = !p);
				break;
			case 13:
				if (p) break;
				e.charCodeAt(d + 1) == 10 && ++d;
			case f:
			case 10:
				if (!p && v()) break outer;
				break;
			default: break;
		}
		return d - u > 0 && v(), i["!ref"] = X(o), i;
	}
	function s(e, n) {
		return !(n && n.PRN) || n.FS || e.slice(0, 4) == "sep=" || e.indexOf("	") >= 0 || e.indexOf(",") >= 0 || e.indexOf(";") >= 0 ? o(e, n) : Br(t(e, n), n);
	}
	function c(e, t) {
		var n = "", i = t.type == "string" ? [
			0,
			0,
			0,
			0
		] : $h(e, t);
		switch (t.type) {
			case "base64":
				n = S(e);
				break;
			case "binary":
				n = e;
				break;
			case "buffer":
				n = t.codepage == 65001 ? e.toString("utf8") : t.codepage && r !== void 0 ? r.utils.decode(t.codepage, e) : C && Buffer.isBuffer(e) ? e.toString("binary") : k(e);
				break;
			case "array":
				n = ht(e);
				break;
			case "string":
				n = e;
				break;
			default: throw Error("Unrecognized type " + t.type);
		}
		return i[0] == 239 && i[1] == 187 && i[2] == 191 ? n = vn(n.slice(3)) : t.type != "string" && t.type != "buffer" && t.codepage == 65001 ? n = vn(n) : t.type == "binary" && r !== void 0 && t.codepage && (n = r.utils.decode(t.codepage, r.utils.encode(28591, n))), n.slice(0, 19) == "socialcalc:version:" ? ls.to_sheet(t.type == "string" ? n : vn(n), t) : s(n, t);
	}
	function l(e, t) {
		return Lr(c(e, t), t);
	}
	function u(e) {
		var t = [];
		if (!e["!ref"]) return "";
		for (var n = Pr(e["!ref"]), r, i = e["!data"] != null, a = n.s.r; a <= n.e.r; ++a) {
			for (var o = [], s = n.s.c; s <= n.e.c; ++s) {
				var c = Y({
					r: a,
					c: s
				});
				if (r = i ? (e["!data"][a] || [])[s] : e[c], !r || r.v == null) {
					o.push("          ");
					continue;
				}
				for (var l = (r.w || (Ir(r), r.w) || "").slice(0, 10); l.length < 10;) l += " ";
				o.push(l + (s === 0 ? " " : ""));
			}
			t.push(o.join(""));
		}
		return t.join("\n");
	}
	return {
		to_workbook: l,
		to_sheet: c,
		from_sheet: u
	};
})();
function ds(e, t) {
	var n = t || {}, r = !!n.WTF;
	n.WTF = !0;
	try {
		var i = ss.to_workbook(e, n);
		return n.WTF = r, i;
	} catch (i) {
		if (n.WTF = r, i.message.indexOf("SYLK bad record ID") == -1 && r) throw i;
		return us.to_workbook(e, t);
	}
}
function fs(e, t) {
	var n = t || {}, r = !!n.WTF;
	n.WTF = !0;
	try {
		var i = cs.to_workbook(e, n);
		if (!i || !i.Sheets) throw "DIF bad workbook";
		var a = i.Sheets[i.SheetNames[0]];
		if (!a || !a["!ref"]) throw "DIF empty worksheet";
		return n.WTF = r, i;
	} catch {
		return n.WTF = r, us.to_workbook(e, t);
	}
}
var ps = /*#__PURE__*/ (function() {
	function e(e, t, n) {
		if (e) {
			pr(e, e.l || 0);
			for (var r = n.Enum || z; e.l < e.length;) {
				var i = e.read_shift(2), a = r[i] || r[65535], o = e.read_shift(2), s = e.l + o, c = a.f && a.f(e, o, n);
				if (e.l = s, t(c, a, i)) return;
			}
		}
	}
	function t(e, t) {
		switch (t.type) {
			case "base64": return r(O(S(e)), t);
			case "binary": return r(O(e), t);
			case "buffer":
			case "array": return r(e, t);
		}
		throw "Unsupported type " + t.type;
	}
	var n = [
		"mmmm",
		"dd-mmm-yyyy",
		"dd-mmm",
		"mmm-yyyy",
		"@",
		"mm/dd",
		"hh:mm:ss AM/PM",
		"hh:mm AM/PM",
		"mm/dd/yyyy",
		"mm/dd",
		"hh:mm:ss",
		"hh:mm"
	];
	function r(t, r) {
		if (!t) return t;
		var i = r || {};
		_ != null && i.dense == null && (i.dense = _);
		var a = {}, o = "Sheet1", s = "", c = 0, l = {}, u = [], d = [], f = [];
		i.dense && (f = a["!data"] = []);
		var p = {
			s: {
				r: 0,
				c: 0
			},
			e: {
				r: 0,
				c: 0
			}
		}, m = i.sheetRows || 0, h = {};
		if (t[4] == 81 && t[5] == 80 && t[6] == 87) return oe(t, r);
		if (t[2] == 0 && (t[3] == 8 || t[3] == 9) && t.length >= 16 && t[14] == 5 && t[15] === 108) throw Error("Unsupported Works 3 for Mac file");
		if (t[2] == 2) i.Enum = z, e(t, function(e, t, r) {
			switch (r) {
				case 0:
					i.vers = e, e >= 4096 && (i.qpro = !0);
					break;
				case 255:
					i.vers = e, i.works = !0;
					break;
				case 6:
					p = e;
					break;
				case 204:
					e && (s = e);
					break;
				case 222:
					s = e;
					break;
				case 15:
				case 51: (!i.qpro && !i.works || r == 51) && e[1].v.charCodeAt(0) < 48 && (e[1].v = e[1].v.slice(1)), (i.works || i.works2) && (e[1].v = e[1].v.replace(/\r\n/g, "\n"));
				case 13:
				case 14:
				case 16:
					(e[2] & 112) == 112 && (e[2] & 15) > 1 && (e[2] & 15) < 15 && (e[1].z = i.dateNF || n[(e[2] & 15) - 1] || V[14], i.cellDates && (e[1].v = lt(e[1].v), e[1].t = typeof e[1].v == "number" ? "n" : "d")), i.qpro && e[3] > c && (a["!ref"] = X(p), l[o] = a, u.push(o), a = {}, i.dense && (f = a["!data"] = []), p = {
						s: {
							r: 0,
							c: 0
						},
						e: {
							r: 0,
							c: 0
						}
					}, c = e[3], o = s || "Sheet" + (c + 1), s = "");
					var d = i.dense ? (f[e[0].r] || [])[e[0].c] : a[Y(e[0])];
					if (d) {
						d.t = e[1].t, d.v = e[1].v, e[1].z != null && (d.z = e[1].z), e[1].f != null && (d.f = e[1].f), h = d;
						break;
					}
					i.dense ? (f[e[0].r] || (f[e[0].r] = []), f[e[0].r][e[0].c] = e[1]) : a[Y(e[0])] = e[1], h = e[1];
					break;
				case 21509:
					i.works2 = !0;
					break;
				case 21506:
					e == 5281 && (h.z = "hh:mm:ss", i.cellDates && h.t == "n" && (h.v = lt(h.v), h.t = typeof h.v == "number" ? "n" : "d"));
					break;
			}
		}, i);
		else if (t[2] == 26 || t[2] == 14) i.Enum = B, t[2] == 14 && (i.qpro = !0, t.l = 0), e(t, function(e, t, n) {
			switch (n) {
				case 204:
					o = e;
					break;
				case 22: e[1].v.charCodeAt(0) < 48 && (e[1].v = e[1].v.slice(1)), e[1].v = e[1].v.replace(/\x0F./g, function(e) {
					return String.fromCharCode(e.charCodeAt(1) - 32);
				}).replace(/\r\n/g, "\n");
				case 23:
				case 24:
				case 25:
				case 37:
				case 39:
				case 40:
					if (e[3] > c && (a["!ref"] = X(p), l[o] = a, u.push(o), a = {}, i.dense && (f = a["!data"] = []), p = {
						s: {
							r: 0,
							c: 0
						},
						e: {
							r: 0,
							c: 0
						}
					}, c = e[3], o = "Sheet" + (c + 1)), m > 0 && e[0].r >= m) break;
					i.dense ? (f[e[0].r] || (f[e[0].r] = []), f[e[0].r][e[0].c] = e[1]) : a[Y(e[0])] = e[1], p.e.c < e[0].c && (p.e.c = e[0].c), p.e.r < e[0].r && (p.e.r = e[0].r);
					break;
				case 27:
					e[14e3] && (d[e[14e3][0]] = e[14e3][1]);
					break;
				case 1537:
					d[e[0]] = e[1], e[0] == c && (o = e[1]);
					break;
				default: break;
			}
		}, i);
		else throw Error("Unrecognized LOTUS BOF " + t[2]);
		if (a["!ref"] = X(p), l[s || o] = a, u.push(s || o), !d.length) return {
			SheetNames: u,
			Sheets: l
		};
		for (var g = {}, v = [], y = 0; y < d.length; ++y) l[u[y]] ? (v.push(d[y] || u[y]), g[d[y]] = l[d[y]] || l[u[y]]) : (v.push(d[y]), g[d[y]] = { "!ref": "A1" });
		return {
			SheetNames: v,
			Sheets: g
		};
	}
	function i(e, t) {
		var n = t || {};
		if (+n.codepage >= 0 && c(+n.codepage), n.type == "string") throw Error("Cannot write WK1 to JS string");
		var r = _r();
		if (!e["!ref"]) throw Error("Cannot export empty sheet to WK1");
		var i = Pr(e["!ref"]), a = e["!data"] != null, s = [];
		Nm(r, 0, o(1030)), Nm(r, 6, u(i));
		for (var l = Math.min(i.e.r, 8191), d = i.s.c; d <= i.e.c; ++d) s[d] = Dr(d);
		for (var f = i.s.r; f <= l; ++f) {
			var p = Cr(f);
			for (d = i.s.c; d <= i.e.c; ++d) {
				var h = a ? (e["!data"][f] || [])[d] : e[s[d] + p];
				if (!(!h || h.t == "z")) switch (h.t) {
					case "n":
						(h.v | 0) == h.v && h.v >= -32768 && h.v <= 32767 ? Nm(r, 13, v(f, d, h)) : Nm(r, 14, b(f, d, h));
						break;
					case "d":
						var g = ct(h.v);
						(g | 0) == g && g >= -32768 && g <= 32767 ? Nm(r, 13, v(f, d, {
							t: "n",
							v: g,
							z: h.z || V[14]
						})) : Nm(r, 14, b(f, d, {
							t: "n",
							v: g,
							z: h.z || V[14]
						}));
						break;
					default:
						var _ = Ir(h);
						Nm(r, 15, m(f, d, _.slice(0, 239)));
				}
			}
		}
		return Nm(r, 1), r.end();
	}
	function a(e, t) {
		var n = t || {};
		if (+n.codepage >= 0 && c(+n.codepage), n.type == "string") throw Error("Cannot write WK3 to JS string");
		var r = _r();
		Nm(r, 0, s(e));
		for (var i = 0, a = 0; i < e.SheetNames.length; ++i) (e.Sheets[e.SheetNames[i]] || {})["!ref"] && Nm(r, 27, R(e.SheetNames[i], a++));
		var o = 0;
		for (i = 0; i < e.SheetNames.length; ++i) {
			var l = e.Sheets[e.SheetNames[i]];
			if (!(!l || !l["!ref"])) {
				for (var u = Pr(l["!ref"]), d = l["!data"] != null, f = [], p = Math.min(u.e.r, 8191), m = u.s.r; m <= p; ++m) for (var h = Cr(m), g = u.s.c; g <= u.e.c; ++g) {
					m === u.s.r && (f[g] = Dr(g));
					var _ = f[g] + h, v = d ? (l["!data"][m] || [])[g] : l[_];
					if (!(!v || v.t == "z")) if (v.t == "n") Nm(r, 23, M(m, g, o, v.v));
					else {
						var y = Ir(v);
						Nm(r, 22, A(m, g, o, y.slice(0, 239)));
					}
				}
				++o;
			}
		}
		return Nm(r, 1), r.end();
	}
	function o(e) {
		var t = hr(2);
		return t.write_shift(2, e), t;
	}
	function s(e) {
		var t = hr(26);
		t.write_shift(2, 4096), t.write_shift(2, 4), t.write_shift(4, 0);
		for (var n = 0, r = 0, i = 0, a = 0; a < e.SheetNames.length; ++a) {
			var o = e.SheetNames[a], s = e.Sheets[o];
			if (!(!s || !s["!ref"])) {
				++i;
				var c = Mr(s["!ref"]);
				n < c.e.r && (n = c.e.r), r < c.e.c && (r = c.e.c);
			}
		}
		return n > 8191 && (n = 8191), t.write_shift(2, n), t.write_shift(1, i), t.write_shift(1, r), t.write_shift(2, 0), t.write_shift(2, 0), t.write_shift(1, 1), t.write_shift(1, 2), t.write_shift(4, 0), t.write_shift(4, 0), t;
	}
	function l(e, t, n) {
		var r = {
			s: {
				c: 0,
				r: 0
			},
			e: {
				c: 0,
				r: 0
			}
		};
		return t == 8 && n.qpro ? (r.s.c = e.read_shift(1), e.l++, r.s.r = e.read_shift(2), r.e.c = e.read_shift(1), e.l++, r.e.r = e.read_shift(2), r) : (r.s.c = e.read_shift(2), r.s.r = e.read_shift(2), t == 12 && n.qpro && (e.l += 2), r.e.c = e.read_shift(2), r.e.r = e.read_shift(2), t == 12 && n.qpro && (e.l += 2), r.s.c == 65535 && (r.s.c = r.e.c = r.s.r = r.e.r = 0), r);
	}
	function u(e) {
		var t = hr(8);
		return t.write_shift(2, e.s.c), t.write_shift(2, e.s.r), t.write_shift(2, e.e.c), t.write_shift(2, e.e.r), t;
	}
	function d(e, t, n) {
		var r = [
			{
				c: 0,
				r: 0
			},
			{
				t: "n",
				v: 0
			},
			0,
			0
		];
		return n.qpro && n.vers != 20768 ? (r[0].c = e.read_shift(1), r[3] = e.read_shift(1), r[0].r = e.read_shift(2), e.l += 2) : n.works ? (r[0].c = e.read_shift(2), r[0].r = e.read_shift(2), r[2] = e.read_shift(2)) : (r[2] = e.read_shift(1), r[0].c = e.read_shift(2), r[0].r = e.read_shift(2)), r;
	}
	function f(e) {
		return e.z && ze(e.z) ? 240 | (n.indexOf(e.z) + 1 || 2) : 255;
	}
	function p(e, t, n) {
		var r = e.l + t, i = d(e, t, n);
		if (i[1].t = "s", (n.vers & 65534) == 20768) {
			e.l++;
			var a = e.read_shift(1);
			return i[1].v = e.read_shift(a, "utf8"), i;
		}
		return n.qpro && e.l++, i[1].v = e.read_shift(r - e.l, "cstr"), i;
	}
	function m(e, t, n) {
		var r = hr(7 + n.length);
		r.write_shift(1, 255), r.write_shift(2, t), r.write_shift(2, e), r.write_shift(1, 39);
		for (var i = 0; i < r.length; ++i) {
			var a = n.charCodeAt(i);
			r.write_shift(1, a >= 128 ? 95 : a);
		}
		return r.write_shift(1, 0), r;
	}
	function h(e, t, n) {
		var r = e.l + t, i = d(e, t, n);
		if (i[1].t = "s", n.vers == 20768) {
			var a = e.read_shift(1);
			return i[1].v = e.read_shift(a, "utf8"), i;
		}
		return i[1].v = e.read_shift(r - e.l, "cstr"), i;
	}
	function g(e, t, n) {
		var r = d(e, t, n);
		return r[1].v = e.read_shift(2, "i"), r;
	}
	function v(e, t, n) {
		var r = hr(7);
		return r.write_shift(1, f(n)), r.write_shift(2, t), r.write_shift(2, e), r.write_shift(2, n.v, "i"), r;
	}
	function y(e, t, n) {
		var r = d(e, t, n);
		return r[1].v = e.read_shift(8, "f"), r;
	}
	function b(e, t, n) {
		var r = hr(13);
		return r.write_shift(1, f(n)), r.write_shift(2, t), r.write_shift(2, e), r.write_shift(8, n.v, "f"), r;
	}
	function x(e, t, n) {
		var r = e.l + t, i = d(e, t, n);
		if (i[1].v = e.read_shift(8, "f"), n.qpro) e.l = r;
		else {
			var a = e.read_shift(2);
			E(e.slice(e.l, e.l + a), i), e.l += a;
		}
		return i;
	}
	function C(e, t, n) {
		var r = t & 32768;
		return t &= -32769, t = (r ? e : 0) + (t >= 8192 ? t - 16384 : t), (r ? "" : "$") + (n ? Dr(t) : Cr(t));
	}
	var w = {
		31: ["NA", 0],
		33: ["ABS", 1],
		34: ["TRUNC", 1],
		35: ["SQRT", 1],
		36: ["LOG", 1],
		37: ["LN", 1],
		38: ["PI", 0],
		39: ["SIN", 1],
		40: ["COS", 1],
		41: ["TAN", 1],
		42: ["ATAN2", 2],
		43: ["ATAN", 1],
		44: ["ASIN", 1],
		45: ["ACOS", 1],
		46: ["EXP", 1],
		47: ["MOD", 2],
		49: ["ISNA", 1],
		50: ["ISERR", 1],
		51: ["FALSE", 0],
		52: ["TRUE", 0],
		53: ["RAND", 0],
		54: ["DATE", 3],
		63: ["ROUND", 2],
		64: ["TIME", 3],
		68: ["ISNUMBER", 1],
		69: ["ISTEXT", 1],
		70: ["LEN", 1],
		71: ["VALUE", 1],
		73: ["MID", 3],
		74: ["CHAR", 1],
		80: ["SUM", 69],
		81: ["AVERAGEA", 69],
		82: ["COUNTA", 69],
		83: ["MINA", 69],
		84: ["MAXA", 69],
		102: ["UPPER", 1],
		103: ["LOWER", 1],
		107: ["PROPER", 1],
		109: ["TRIM", 1],
		111: ["T", 1]
	}, T = /* @__PURE__ */ ".........+.-.*./.^.=.<>.<=.>=.<.>.....&.......".split(".");
	function E(e, t) {
		pr(e, 0);
		for (var n = [], r = 0, i = "", a = "", o = "", s = ""; e.l < e.length;) {
			var c = e[e.l++];
			switch (c) {
				case 0:
					n.push(e.read_shift(8, "f"));
					break;
				case 1:
					a = C(t[0].c, e.read_shift(2), !0), i = C(t[0].r, e.read_shift(2), !1), n.push(a + i);
					break;
				case 2:
					var l = C(t[0].c, e.read_shift(2), !0), u = C(t[0].r, e.read_shift(2), !1);
					a = C(t[0].c, e.read_shift(2), !0), i = C(t[0].r, e.read_shift(2), !1), n.push(l + u + ":" + a + i);
					break;
				case 3:
					if (e.l < e.length) {
						console.error("WK1 premature formula end");
						return;
					}
					break;
				case 4:
					n.push("(" + n.pop() + ")");
					break;
				case 5:
					n.push(e.read_shift(2));
					break;
				case 6:
					for (var d = ""; c = e[e.l++];) d += String.fromCharCode(c);
					n.push("\"" + d.replace(/"/g, "\"\"") + "\"");
					break;
				case 8:
					n.push("-" + n.pop());
					break;
				case 23:
					n.push("+" + n.pop());
					break;
				case 22:
					n.push("NOT(" + n.pop() + ")");
					break;
				case 20:
				case 21:
					s = n.pop(), o = n.pop(), n.push(["AND", "OR"][c - 20] + "(" + o + "," + s + ")");
					break;
				default: if (c < 32 && T[c]) s = n.pop(), o = n.pop(), n.push(o + T[c] + s);
				else if (w[c]) {
					if (r = w[c][1], r == 69 && (r = e[e.l++]), r > n.length) {
						console.error("WK1 bad formula parse 0x" + c.toString(16) + ":|" + n.join("|") + "|");
						return;
					}
					var f = n.slice(-r);
					n.length -= r, n.push(w[c][0] + "(" + f.join(",") + ")");
				} else if (c <= 7) return console.error("WK1 invalid opcode " + c.toString(16));
				else if (c <= 24) return console.error("WK1 unsupported op " + c.toString(16));
				else if (c <= 30) return console.error("WK1 invalid opcode " + c.toString(16));
				else if (c <= 115) return console.error("WK1 unsupported function opcode " + c.toString(16));
				else return console.error("WK1 unrecognized opcode " + c.toString(16));
			}
		}
		n.length == 1 ? t[1].f = "" + n[0] : console.error("WK1 bad formula parse |" + n.join("|") + "|");
	}
	function D(e) {
		var t = [
			{
				c: 0,
				r: 0
			},
			{
				t: "n",
				v: 0
			},
			0
		];
		return t[0].r = e.read_shift(2), t[3] = e[e.l++], t[0].c = e[e.l++], t;
	}
	function k(e, t) {
		var n = D(e, t);
		return n[1].t = "s", n[1].v = e.read_shift(t - 4, "cstr"), n;
	}
	function A(e, t, n, r) {
		var i = hr(6 + r.length);
		i.write_shift(2, e), i.write_shift(1, n), i.write_shift(1, t), i.write_shift(1, 39);
		for (var a = 0; a < r.length; ++a) {
			var o = r.charCodeAt(a);
			i.write_shift(1, o >= 128 ? 95 : o);
		}
		return i.write_shift(1, 0), i;
	}
	function j(e, t) {
		var n = D(e, t);
		n[1].v = e.read_shift(2);
		var r = n[1].v >> 1;
		if (n[1].v & 1) switch (r & 7) {
			case 0:
				r = (r >> 3) * 5e3;
				break;
			case 1:
				r = (r >> 3) * 500;
				break;
			case 2:
				r = (r >> 3) / 20;
				break;
			case 3:
				r = (r >> 3) / 200;
				break;
			case 4:
				r = (r >> 3) / 2e3;
				break;
			case 5:
				r = (r >> 3) / 2e4;
				break;
			case 6:
				r = (r >> 3) / 16;
				break;
			case 7:
				r = (r >> 3) / 64;
				break;
		}
		return n[1].v = r, n;
	}
	function ee(e, t) {
		var n = D(e, t), r = e.read_shift(4), i = e.read_shift(4), a = e.read_shift(2);
		if (a == 65535) return r === 0 && i === 3221225472 ? (n[1].t = "e", n[1].v = 15) : r === 0 && i === 3489660928 ? (n[1].t = "e", n[1].v = 42) : n[1].v = 0, n;
		var o = a & 32768;
		return a = (a & 32767) - 16446, n[1].v = (1 - o * 2) * (i * 2 ** (a + 32) + r * 2 ** a), n;
	}
	function M(e, t, n, r) {
		var i = hr(14);
		if (i.write_shift(2, e), i.write_shift(1, n), i.write_shift(1, t), r == 0) return i.write_shift(4, 0), i.write_shift(4, 0), i.write_shift(2, 65535), i;
		var a = 0, o = 0, s = 0, c = 0;
		return r < 0 && (a = 1, r = -r), o = Math.log2(r) | 0, r /= 2 ** (o - 31), c = r >>> 0, c & 2147483648 || (r /= 2, ++o, c = r >>> 0), r -= c, c |= 2147483648, c >>>= 0, r *= 2 ** 32, s = r >>> 0, i.write_shift(4, s), i.write_shift(4, c), o += 16383 + (a ? 32768 : 0), i.write_shift(2, o), i;
	}
	function N(e, t) {
		var n = ee(e, 14);
		return e.l += t - 14, n;
	}
	function P(e, t) {
		var n = D(e, t), r = e.read_shift(4);
		return n[1].v = r >> 6, n;
	}
	function F(e, t) {
		var n = D(e, t), r = e.read_shift(8, "f");
		return n[1].v = r, n;
	}
	function I(e, t) {
		var n = F(e, 12);
		return e.l += t - 12, n;
	}
	function L(e, t) {
		return e[e.l + t - 1] == 0 ? e.read_shift(t, "cstr") : "";
	}
	function te(e, t) {
		var n = e[e.l++];
		n > t - 1 && (n = t - 1);
		for (var r = ""; r.length < n;) r += String.fromCharCode(e[e.l++]);
		return r;
	}
	function ne(e, t, n) {
		if (!(!n.qpro || t < 21)) {
			var r = e.read_shift(1);
			return e.l += 17, e.l += 1, e.l += 2, [r, e.read_shift(t - 21, "cstr")];
		}
	}
	function re(e, t) {
		for (var n = {}, r = e.l + t; e.l < r;) {
			var i = e.read_shift(2);
			if (i == 14e3) {
				for (n[i] = [0, ""], n[i][0] = e.read_shift(2); e[e.l];) n[i][1] += String.fromCharCode(e[e.l]), e.l++;
				e.l++;
			}
		}
		return n;
	}
	function R(e, t) {
		var n = hr(5 + e.length);
		n.write_shift(2, 14e3), n.write_shift(2, t);
		for (var r = 0; r < e.length; ++r) {
			var i = e.charCodeAt(r);
			n[n.l++] = i > 127 ? 95 : i;
		}
		return n[n.l++] = 0, n;
	}
	var z = {
		0: {
			n: "BOF",
			f: fa
		},
		1: { n: "EOF" },
		2: { n: "CALCMODE" },
		3: { n: "CALCORDER" },
		4: { n: "SPLIT" },
		5: { n: "SYNC" },
		6: {
			n: "RANGE",
			f: l
		},
		7: { n: "WINDOW1" },
		8: { n: "COLW1" },
		9: { n: "WINTWO" },
		10: { n: "COLW2" },
		11: { n: "NAME" },
		12: { n: "BLANK" },
		13: {
			n: "INTEGER",
			f: g
		},
		14: {
			n: "NUMBER",
			f: y
		},
		15: {
			n: "LABEL",
			f: p
		},
		16: {
			n: "FORMULA",
			f: x
		},
		24: { n: "TABLE" },
		25: { n: "ORANGE" },
		26: { n: "PRANGE" },
		27: { n: "SRANGE" },
		28: { n: "FRANGE" },
		29: { n: "KRANGE1" },
		32: { n: "HRANGE" },
		35: { n: "KRANGE2" },
		36: { n: "PROTEC" },
		37: { n: "FOOTER" },
		38: { n: "HEADER" },
		39: { n: "SETUP" },
		40: { n: "MARGINS" },
		41: { n: "LABELFMT" },
		42: { n: "TITLES" },
		43: { n: "SHEETJS" },
		45: { n: "GRAPH" },
		46: { n: "NGRAPH" },
		47: { n: "CALCCOUNT" },
		48: { n: "UNFORMATTED" },
		49: { n: "CURSORW12" },
		50: { n: "WINDOW" },
		51: {
			n: "STRING",
			f: h
		},
		55: { n: "PASSWORD" },
		56: { n: "LOCKED" },
		60: { n: "QUERY" },
		61: { n: "QUERYNAME" },
		62: { n: "PRINT" },
		63: { n: "PRINTNAME" },
		64: { n: "GRAPH2" },
		65: { n: "GRAPHNAME" },
		66: { n: "ZOOM" },
		67: { n: "SYMSPLIT" },
		68: { n: "NSROWS" },
		69: { n: "NSCOLS" },
		70: { n: "RULER" },
		71: { n: "NNAME" },
		72: { n: "ACOMM" },
		73: { n: "AMACRO" },
		74: { n: "PARSE" },
		102: { n: "PRANGES??" },
		103: { n: "RRANGES??" },
		104: { n: "FNAME??" },
		105: { n: "MRANGES??" },
		204: {
			n: "SHEETNAMECS",
			f: L
		},
		222: {
			n: "SHEETNAMELP",
			f: te
		},
		255: {
			n: "BOF",
			f: fa
		},
		21506: {
			n: "WKSNF",
			f: fa
		},
		65535: { n: "" }
	}, B = {
		0: { n: "BOF" },
		1: { n: "EOF" },
		2: { n: "PASSWORD" },
		3: { n: "CALCSET" },
		4: { n: "WINDOWSET" },
		5: { n: "SHEETCELLPTR" },
		6: { n: "SHEETLAYOUT" },
		7: { n: "COLUMNWIDTH" },
		8: { n: "HIDDENCOLUMN" },
		9: { n: "USERRANGE" },
		10: { n: "SYSTEMRANGE" },
		11: { n: "ZEROFORCE" },
		12: { n: "SORTKEYDIR" },
		13: { n: "FILESEAL" },
		14: { n: "DATAFILLNUMS" },
		15: { n: "PRINTMAIN" },
		16: { n: "PRINTSTRING" },
		17: { n: "GRAPHMAIN" },
		18: { n: "GRAPHSTRING" },
		19: { n: "??" },
		20: { n: "ERRCELL" },
		21: { n: "NACELL" },
		22: {
			n: "LABEL16",
			f: k
		},
		23: {
			n: "NUMBER17",
			f: ee
		},
		24: {
			n: "NUMBER18",
			f: j
		},
		25: {
			n: "FORMULA19",
			f: N
		},
		26: { n: "FORMULA1A" },
		27: {
			n: "XFORMAT",
			f: re
		},
		28: { n: "DTLABELMISC" },
		29: { n: "DTLABELCELL" },
		30: { n: "GRAPHWINDOW" },
		31: { n: "CPA" },
		32: { n: "LPLAUTO" },
		33: { n: "QUERY" },
		34: { n: "HIDDENSHEET" },
		35: { n: "??" },
		37: {
			n: "NUMBER25",
			f: P
		},
		38: { n: "??" },
		39: {
			n: "NUMBER27",
			f: F
		},
		40: {
			n: "FORMULA28",
			f: I
		},
		142: { n: "??" },
		147: { n: "??" },
		150: { n: "??" },
		151: { n: "??" },
		152: { n: "??" },
		153: { n: "??" },
		154: { n: "??" },
		155: { n: "??" },
		156: { n: "??" },
		163: { n: "??" },
		174: { n: "??" },
		175: { n: "??" },
		176: { n: "??" },
		177: { n: "??" },
		184: { n: "??" },
		185: { n: "??" },
		186: { n: "??" },
		187: { n: "??" },
		188: { n: "??" },
		195: { n: "??" },
		201: { n: "??" },
		204: {
			n: "SHEETNAMECS",
			f: L
		},
		205: { n: "??" },
		206: { n: "??" },
		207: { n: "??" },
		208: { n: "??" },
		256: { n: "??" },
		259: { n: "??" },
		260: { n: "??" },
		261: { n: "??" },
		262: { n: "??" },
		263: { n: "??" },
		265: { n: "??" },
		266: { n: "??" },
		267: { n: "??" },
		268: { n: "??" },
		270: { n: "??" },
		271: { n: "??" },
		384: { n: "??" },
		389: { n: "??" },
		390: { n: "??" },
		393: { n: "??" },
		396: { n: "??" },
		512: { n: "??" },
		514: { n: "??" },
		513: { n: "??" },
		516: { n: "??" },
		517: { n: "??" },
		640: { n: "??" },
		641: { n: "??" },
		642: { n: "??" },
		643: { n: "??" },
		644: { n: "??" },
		645: { n: "??" },
		646: { n: "??" },
		647: { n: "??" },
		648: { n: "??" },
		658: { n: "??" },
		659: { n: "??" },
		660: { n: "??" },
		661: { n: "??" },
		662: { n: "??" },
		665: { n: "??" },
		666: { n: "??" },
		768: { n: "??" },
		772: { n: "??" },
		1537: {
			n: "SHEETINFOQP",
			f: ne
		},
		1600: { n: "??" },
		1602: { n: "??" },
		1793: { n: "??" },
		1794: { n: "??" },
		1795: { n: "??" },
		1796: { n: "??" },
		1920: { n: "??" },
		2048: { n: "??" },
		2049: { n: "??" },
		2052: { n: "??" },
		2688: { n: "??" },
		10998: { n: "??" },
		12849: { n: "??" },
		28233: { n: "??" },
		28484: { n: "??" },
		65535: { n: "" }
	}, ie = {
		5: "dd-mmm-yy",
		6: "dd-mmm",
		7: "mmm-yy",
		8: "mm/dd/yy",
		10: "hh:mm:ss AM/PM",
		11: "hh:mm AM/PM",
		14: "dd-mmm-yyyy",
		15: "mmm-yyyy",
		34: "0.00",
		50: "0.00;[Red]0.00",
		66: "0.00;(0.00)",
		82: "0.00;[Red](0.00)",
		162: "\"$\"#,##0.00;\\(\"$\"#,##0.00\\)",
		288: "0%",
		304: "0E+00",
		320: "# ?/?"
	};
	function ae(e) {
		var t = e.read_shift(2), n = e.read_shift(1);
		if (n != 0) throw "unsupported QPW string type " + n.toString(16);
		return e.read_shift(t, "sbcs-cont");
	}
	function oe(e, t) {
		pr(e, 0);
		var n = t || {};
		_ != null && n.dense == null && (n.dense = _);
		var r = {};
		n.dense && (r["!data"] = []);
		var i = [], a = "", o = {
			s: {
				r: -1,
				c: -1
			},
			e: {
				r: -1,
				c: -1
			}
		}, s = 0, c = 0, l = 0, u = 0, d = {
			SheetNames: [],
			Sheets: {}
		}, f = [];
		outer: for (; e.l < e.length;) {
			var p = e.read_shift(2), m = e.read_shift(2), h = e.slice(e.l, e.l + m);
			switch (pr(h, 0), p) {
				case 1:
					if (h.read_shift(4) != 962023505) throw "Bad QPW9 BOF!";
					break;
				case 2: break outer;
				case 8: break;
				case 10:
					for (var g = h.read_shift(4), v = (h.length - h.l) / g | 0, y = 0; y < g; ++y) {
						var b = h.l + v, x = {};
						h.l += 2, x.numFmtId = h.read_shift(2), ie[x.numFmtId] && (x.z = ie[x.numFmtId]), h.l = b, f.push(x);
					}
					break;
				case 1025: break;
				case 1026: break;
				case 1031:
					for (h.l += 12; h.l < h.length;) s = h.read_shift(2), c = h.read_shift(1), i.push(h.read_shift(s, "cstr"));
					break;
				case 1032: break;
				case 1537:
					var S = h.read_shift(2);
					r = {}, n.dense && (r["!data"] = []), o.s.c = h.read_shift(2), o.e.c = h.read_shift(2), o.s.r = h.read_shift(4), o.e.r = h.read_shift(4), h.l += 4, h.l + 2 < h.length && (s = h.read_shift(2), c = h.read_shift(1), a = s == 0 ? "" : h.read_shift(s, "cstr")), a || (a = Dr(S));
					break;
				case 1538:
					if (o.s.c > 255 || o.s.r > 999999) break;
					o.e.c < o.s.c && (o.e.c = o.s.c), o.e.r < o.s.r && (o.e.r = o.s.r), r["!ref"] = X(o), bg(d, r, a);
					break;
				case 2561:
					l = h.read_shift(2), o.e.c < l && (o.e.c = l), o.s.c > l && (o.s.c = l), u = h.read_shift(4), o.s.r > u && (o.s.r = u), u = h.read_shift(4), o.e.r < u && (o.e.r = u);
					break;
				case 3073:
					u = h.read_shift(4), s = h.read_shift(4), o.s.r > u && (o.s.r = u), o.e.r < u + s - 1 && (o.e.r = u + s - 1);
					for (var C = Dr(l); h.l < h.length;) {
						var w = { t: "z" }, T = h.read_shift(1), E = -1;
						T & 128 && (E = h.read_shift(2));
						var D = T & 64 ? h.read_shift(2) - 1 : 0;
						switch (T & 31) {
							case 0: break;
							case 1: break;
							case 2:
								w = {
									t: "n",
									v: h.read_shift(2)
								};
								break;
							case 3:
								w = {
									t: "n",
									v: h.read_shift(2, "i")
								};
								break;
							case 4:
								w = {
									t: "n",
									v: Qr(h)
								};
								break;
							case 5:
								w = {
									t: "n",
									v: h.read_shift(8, "f")
								};
								break;
							case 7:
								w = {
									t: "s",
									v: i[c = h.read_shift(4) - 1]
								};
								break;
							case 8:
								w = {
									t: "n",
									v: h.read_shift(8, "f")
								}, h.l += 2, h.l += 4, isNaN(w.v) && (w = {
									t: "e",
									v: 15
								});
								break;
							default: throw "Unrecognized QPW cell type " + (T & 31);
						}
						E != -1 && (f[E - 1] || {}).z && (w.z = f[E - 1].z);
						var O = 0;
						if (T & 32) switch (T & 31) {
							case 2:
								O = h.read_shift(2);
								break;
							case 3:
								O = h.read_shift(2, "i");
								break;
							case 7:
								O = h.read_shift(2);
								break;
							default: throw "Unsupported delta for QPW cell type " + (T & 31);
						}
						if (!(!n.sheetStubs && w.t == "z")) {
							var k = gt(w);
							w.t == "n" && w.z && ze(w.z) && n.cellDates && (k.v = lt(w.v), k.t = typeof k.v == "number" ? "n" : "d"), r["!data"] == null ? r[C + Cr(u)] = k : (r["!data"][u] || (r["!data"][u] = []), r["!data"][u][l] = k);
						}
						for (++u, --s; D-- > 0 && s >= 0;) {
							if (T & 32) switch (T & 31) {
								case 2:
									w = {
										t: "n",
										v: w.v + O & 65535
									};
									break;
								case 3:
									w = {
										t: "n",
										v: w.v + O & 65535
									}, w.v > 32767 && (w.v -= 65536);
									break;
								case 7:
									w = {
										t: "s",
										v: i[c = c + O >>> 0]
									};
									break;
								default: throw "Cannot apply delta for QPW cell type " + (T & 31);
							}
							else switch (T & 31) {
								case 1:
									w = { t: "z" };
									break;
								case 2:
									w = {
										t: "n",
										v: h.read_shift(2)
									};
									break;
								case 7:
									w = {
										t: "s",
										v: i[c = h.read_shift(4) - 1]
									};
									break;
								default: throw "Cannot apply repeat for QPW cell type " + (T & 31);
							}
							!n.sheetStubs && w.t == "z" || (r["!data"] == null ? r[C + Cr(u)] = w : (r["!data"][u] || (r["!data"][u] = []), r["!data"][u][l] = w)), ++u, --s;
						}
					}
					break;
				case 3074:
					l = h.read_shift(2), u = h.read_shift(4);
					var A = ae(h);
					r["!data"] == null ? r[Dr(l) + Cr(u)] = {
						t: "s",
						v: A
					} : (r["!data"][u] || (r["!data"][u] = []), r["!data"][u][l] = {
						t: "s",
						v: A
					});
					break;
				default: break;
			}
			e.l += m;
		}
		return d;
	}
	return {
		sheet_to_wk1: i,
		book_to_wk3: a,
		to_workbook: t
	};
})();
function ms(e) {
	var t = {}, n = e.match(en), r = 0, i = !1;
	if (n) for (; r != n.length; ++r) {
		var o = K(n[r]);
		switch (o[0].replace(/<\w*:/g, "<")) {
			case "<condense": break;
			case "<extend": break;
			case "<shadow": if (!o.val) break;
			case "<shadow>":
			case "<shadow/>":
				t.shadow = 1;
				break;
			case "</shadow>": break;
			case "<charset":
				if (o.val == "1") break;
				t.cp = a[parseInt(o.val, 10)];
				break;
			case "<outline": if (!o.val) break;
			case "<outline>":
			case "<outline/>":
				t.outline = 1;
				break;
			case "</outline>": break;
			case "<rFont":
				t.name = o.val;
				break;
			case "<sz":
				t.sz = o.val;
				break;
			case "<strike": if (!o.val) break;
			case "<strike>":
			case "<strike/>":
				t.strike = 1;
				break;
			case "</strike>": break;
			case "<u":
				if (!o.val) break;
				switch (o.val) {
					case "double":
						t.uval = "double";
						break;
					case "singleAccounting":
						t.uval = "single-accounting";
						break;
					case "doubleAccounting":
						t.uval = "double-accounting";
						break;
				}
			case "<u>":
			case "<u/>":
				t.u = 1;
				break;
			case "</u>": break;
			case "<b": if (o.val == "0") break;
			case "<b>":
			case "<b/>":
				t.b = 1;
				break;
			case "</b>": break;
			case "<i": if (o.val == "0") break;
			case "<i>":
			case "<i/>":
				t.i = 1;
				break;
			case "</i>": break;
			case "<color":
				o.rgb && (t.color = o.rgb.slice(2, 8));
				break;
			case "<color>":
			case "<color/>":
			case "</color>": break;
			case "<family":
				t.family = o.val;
				break;
			case "<family>":
			case "<family/>":
			case "</family>": break;
			case "<vertAlign":
				t.valign = o.val;
				break;
			case "<vertAlign>":
			case "<vertAlign/>":
			case "</vertAlign>": break;
			case "<scheme": break;
			case "<scheme>":
			case "<scheme/>":
			case "</scheme>": break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>": break;
			case "<ext":
				i = !0;
				break;
			case "</ext>":
				i = !1;
				break;
			default: if (o[0].charCodeAt(1) !== 47 && !i) throw Error("Unrecognized rich format " + o[0]);
		}
	}
	return t;
}
var hs = /*#__PURE__*/ (function() {
	function e(e) {
		var t = Ft(e, "t");
		if (!t) return {
			t: "s",
			v: ""
		};
		var n = {
			t: "s",
			v: q(t[1])
		}, r = Ft(e, "rPr");
		return r && (n.s = ms(r[1])), n;
	}
	var t = /<(?:\w+:)?r>/g, n = /<\/(?:\w+:)?r>/;
	return function(r) {
		return r.replace(t, "").split(n).map(e).filter(function(e) {
			return e.v;
		});
	};
})(), gs = /*#__PURE__*/ (function() {
	var e = /(\r\n|\n)/g;
	function t(e, t, n) {
		var r = [];
		e.u && r.push("text-decoration: underline;"), e.uval && r.push("text-underline-style:" + e.uval + ";"), e.sz && r.push("font-size:" + e.sz + "pt;"), e.outline && r.push("text-effect: outline;"), e.shadow && r.push("text-shadow: auto;"), t.push("<span style=\"" + r.join("") + "\">"), e.b && (t.push("<b>"), n.push("</b>")), e.i && (t.push("<i>"), n.push("</i>")), e.strike && (t.push("<s>"), n.push("</s>"));
		var i = e.valign || "";
		return i == "superscript" || i == "super" ? i = "sup" : i == "subscript" && (i = "sub"), i != "" && (t.push("<" + i + ">"), n.push("</" + i + ">")), n.push("</span>"), e;
	}
	function n(n) {
		var r = [
			[],
			n.v,
			[]
		];
		return n.v ? (n.s && t(n.s, r[0], r[2]), r[0].join("") + r[1].replace(e, "<br/>") + r[2].join("")) : "";
	}
	return function(e) {
		return e.map(n).join("");
	};
})(), _s = /<(?:\w+:)?t\b[^<>]*>([^<]*)<\/(?:\w+:)?t>/g, vs = /<(?:\w+:)?r\b[^<>]*>/;
function ys(e, t) {
	var n = t ? t.cellHTML : !0, r = {};
	return e ? (e.match(/^\s*<(?:\w+:)?t[^>]*>/) ? (r.t = q(vn(e.slice(e.indexOf(">") + 1).split(/<\/(?:\w+:)?t>/)[0] || ""), !0), r.r = vn(e), n && (r.h = fn(r.t))) : e.match(vs) && (r.r = vn(e), r.t = q(vn((Lt(e, "rPh").match(_s) || []).join("").replace(en, "")), !0), n && (r.h = gs(hs(r.r)))), r) : { t: "" };
}
var bs = /<(?:\w+:)?(?:si|sstItem)>/g, xs = /<\/(?:\w+:)?(?:si|sstItem)>/;
function Ss(e, t) {
	var n = [], r = "";
	if (!e) return n;
	var i = Ft(e, "sst");
	if (i) {
		r = i[1].replace(bs, "").split(xs);
		for (var a = 0; a != r.length; ++a) {
			var o = ys(r[a].trim(), t);
			o != null && (n[n.length] = o);
		}
		i = K(i[0].slice(0, i[0].indexOf(">"))), n.Count = i.count, n.Unique = i.uniqueCount;
	}
	return n;
}
function Cs(e) {
	return [e.read_shift(4), e.read_shift(4)];
}
function ws(e, t) {
	var n = [], r = !1;
	return gr(e, function(e, i, a) {
		switch (a) {
			case 159:
				n.Count = e[0], n.Unique = e[1];
				break;
			case 19:
				n.push(e);
				break;
			case 160: return !0;
			case 35:
				r = !0;
				break;
			case 36:
				r = !1;
				break;
			default: if (i.T, !r || t.WTF) throw Error("Unexpected record 0x" + a.toString(16));
		}
	}), n;
}
function Ts(e) {
	if (r !== void 0) return r.utils.encode(n, e);
	for (var t = [], i = e.split(""), a = 0; a < i.length; ++a) t[a] = i[a].charCodeAt(0);
	return t;
}
function Es(e, t) {
	var n = {};
	return n.Major = e.read_shift(2), n.Minor = e.read_shift(2), t >= 4 && (e.l += t - 4), n;
}
function Ds(e) {
	var t = {};
	return t.id = e.read_shift(0, "lpp4"), t.R = Es(e, 4), t.U = Es(e, 4), t.W = Es(e, 4), t;
}
function Os(e) {
	for (var t = e.read_shift(4), n = e.l + t - 4, r = {}, i = e.read_shift(4), a = []; i-- > 0;) a.push({
		t: e.read_shift(4),
		v: e.read_shift(0, "lpp4")
	});
	if (r.name = e.read_shift(0, "lpp4"), r.comps = a, e.l != n) throw Error("Bad DataSpaceMapEntry: " + e.l + " != " + n);
	return r;
}
function ks(e) {
	var t = [];
	e.l += 4;
	for (var n = e.read_shift(4); n-- > 0;) t.push(Os(e));
	return t;
}
function As(e) {
	var t = [];
	e.l += 4;
	for (var n = e.read_shift(4); n-- > 0;) t.push(e.read_shift(0, "lpp4"));
	return t;
}
function js(e) {
	var t = {};
	return e.read_shift(4), e.l += 4, t.id = e.read_shift(0, "lpp4"), t.name = e.read_shift(0, "lpp4"), t.R = Es(e, 4), t.U = Es(e, 4), t.W = Es(e, 4), t;
}
function Ms(e) {
	var t = js(e);
	if (t.ename = e.read_shift(0, "8lpp4"), t.blksz = e.read_shift(4), t.cmode = e.read_shift(4), e.read_shift(4) != 4) throw Error("Bad !Primary record");
	return t;
}
function Ns(e, t) {
	var n = e.l + t, r = {};
	r.Flags = e.read_shift(4) & 63, e.l += 4, r.AlgID = e.read_shift(4);
	var i = !1;
	switch (r.AlgID) {
		case 26126:
		case 26127:
		case 26128:
			i = r.Flags == 36;
			break;
		case 26625:
			i = r.Flags == 4;
			break;
		case 0:
			i = r.Flags == 16 || r.Flags == 4 || r.Flags == 36;
			break;
		default: throw "Unrecognized encryption algorithm: " + r.AlgID;
	}
	if (!i) throw Error("Encryption Flags/AlgID mismatch");
	return r.AlgIDHash = e.read_shift(4), r.KeySize = e.read_shift(4), r.ProviderType = e.read_shift(4), e.l += 8, r.CSPName = e.read_shift(n - e.l >> 1, "utf16le"), e.l = n, r;
}
function Ps(e, t) {
	var n = {}, r = e.l + t;
	return e.l += 4, n.Salt = e.slice(e.l, e.l + 16), e.l += 16, n.Verifier = e.slice(e.l, e.l + 16), e.l += 16, e.read_shift(4), n.VerifierHash = e.slice(e.l, r), e.l = r, n;
}
function Fs(e) {
	var t = Es(e);
	switch (t.Minor) {
		case 2: return [t.Minor, Is(e, t)];
		case 3: return [t.Minor, Ls(e, t)];
		case 4: return [t.Minor, Rs(e, t)];
	}
	throw Error("ECMA-376 Encrypted file unrecognized Version: " + t.Minor);
}
function Is(e) {
	if ((e.read_shift(4) & 63) != 36) throw Error("EncryptionInfo mismatch");
	return {
		t: "Std",
		h: Ns(e, e.read_shift(4)),
		v: Ps(e, e.length - e.l)
	};
}
function Ls() {
	throw Error("File is password-protected: ECMA-376 Extensible");
}
function Rs(e) {
	var t = [
		"saltSize",
		"blockSize",
		"keyBits",
		"hashSize",
		"cipherAlgorithm",
		"cipherChaining",
		"hashAlgorithm",
		"saltValue"
	];
	e.l += 4;
	var n = e.read_shift(e.length - e.l, "utf8"), r = {};
	return n.replace(en, function(e) {
		var n = K(e);
		switch (an(n[0])) {
			case "<?xml": break;
			case "<encryption":
			case "</encryption>": break;
			case "<keyData":
				t.forEach(function(e) {
					r[e] = n[e];
				});
				break;
			case "<dataIntegrity":
				r.encryptedHmacKey = n.encryptedHmacKey, r.encryptedHmacValue = n.encryptedHmacValue;
				break;
			case "<keyEncryptors>":
			case "<keyEncryptors":
				r.encs = [];
				break;
			case "</keyEncryptors>": break;
			case "<keyEncryptor":
				r.uri = n.uri;
				break;
			case "</keyEncryptor>": break;
			case "<encryptedKey":
				r.encs.push(n);
				break;
			default: throw n[0];
		}
	}), r;
}
function zs(e, t) {
	var n = {}, r = n.EncryptionVersionInfo = Es(e, 4);
	if (t -= 4, r.Minor != 2) throw Error("unrecognized minor version code: " + r.Minor);
	if (r.Major > 4 || r.Major < 2) throw Error("unrecognized major version code: " + r.Major);
	n.Flags = e.read_shift(4), t -= 4;
	var i = e.read_shift(4);
	return t -= 4, n.EncryptionHeader = Ns(e, i), t -= i, n.EncryptionVerifier = Ps(e, t), n;
}
function Bs(e) {
	var t = {}, n = t.EncryptionVersionInfo = Es(e, 4);
	if (n.Major != 1 || n.Minor != 1) throw "unrecognized version code " + n.Major + " : " + n.Minor;
	return t.Salt = e.read_shift(16), t.EncryptedVerifier = e.read_shift(16), t.EncryptedVerifierHash = e.read_shift(16), t;
}
function Vs(e) {
	var t = 0, n, r = Ts(e), i = r.length + 1, a, o, s, c, l;
	for (n = E(i), n[0] = r.length, a = 1; a != i; ++a) n[a] = r[a - 1];
	for (a = i - 1; a >= 0; --a) o = n[a], s = t & 16384 ? 1 : 0, c = t << 1 & 32767, l = s | c, t = l ^ o;
	return t ^ 52811;
}
var Hs = /*#__PURE__*/ (function() {
	var e = [
		187,
		255,
		255,
		186,
		255,
		255,
		185,
		128,
		0,
		190,
		15,
		0,
		191,
		15,
		0
	], t = [
		57840,
		7439,
		52380,
		33984,
		4364,
		3600,
		61902,
		12606,
		6258,
		57657,
		54287,
		34041,
		10252,
		43370,
		20163
	], n = [
		44796,
		19929,
		39858,
		10053,
		20106,
		40212,
		10761,
		31585,
		63170,
		64933,
		60267,
		50935,
		40399,
		11199,
		17763,
		35526,
		1453,
		2906,
		5812,
		11624,
		23248,
		885,
		1770,
		3540,
		7080,
		14160,
		28320,
		56640,
		55369,
		41139,
		20807,
		41614,
		21821,
		43642,
		17621,
		28485,
		56970,
		44341,
		19019,
		38038,
		14605,
		29210,
		60195,
		50791,
		40175,
		10751,
		21502,
		43004,
		24537,
		18387,
		36774,
		3949,
		7898,
		15796,
		31592,
		63184,
		47201,
		24803,
		49606,
		37805,
		14203,
		28406,
		56812,
		17824,
		35648,
		1697,
		3394,
		6788,
		13576,
		27152,
		43601,
		17539,
		35078,
		557,
		1114,
		2228,
		4456,
		30388,
		60776,
		51953,
		34243,
		7079,
		14158,
		28316,
		14128,
		28256,
		56512,
		43425,
		17251,
		34502,
		7597,
		13105,
		26210,
		52420,
		35241,
		883,
		1766,
		3532,
		4129,
		8258,
		16516,
		33032,
		4657,
		9314,
		18628
	], r = function(e) {
		return (e / 2 | e * 128) & 255;
	}, i = function(e, t) {
		return r(e ^ t);
	}, a = function(e) {
		for (var r = t[e.length - 1], i = 104, a = e.length - 1; a >= 0; --a) for (var o = e[a], s = 0; s != 7; ++s) o & 64 && (r ^= n[i]), o *= 2, --i;
		return r;
	};
	return function(t) {
		for (var n = Ts(t), r = a(n), o = n.length, s = E(16), c = 0; c != 16; ++c) s[c] = 0;
		var l, u, d;
		for ((o & 1) == 1 && (l = r >> 8, s[o] = i(e[0], l), --o, l = r & 255, u = n[n.length - 1], s[o] = i(u, l)); o > 0;) --o, l = r >> 8, s[o] = i(n[o], l), --o, l = r & 255, s[o] = i(n[o], l);
		for (o = 15, d = 15 - n.length; d > 0;) l = r >> 8, s[o] = i(e[d], l), --o, --d, l = r & 255, s[o] = i(n[o], l), --o, --d;
		return s;
	};
})(), Us = function(e, t, n, r, i) {
	i || (i = t), r || (r = Hs(e));
	var a, o;
	for (a = 0; a != t.length; ++a) o = t[a], o ^= r[n], o = (o >> 5 | o << 3) & 255, i[a] = o, ++n;
	return [
		i,
		n,
		r
	];
}, Ws = function(e) {
	var t = 0, n = Hs(e);
	return function(e) {
		var r = Us("", e, t, n);
		return t = r[1], r[0];
	};
};
function Gs(e, t, n, r) {
	var i = {
		key: fa(e),
		verificationBytes: fa(e)
	};
	return n.password && (i.verifier = Vs(n.password)), r.valid = i.verificationBytes === i.verifier, r.valid && (r.insitu = Ws(n.password)), i;
}
function Ks(e, t, n) {
	var r = n || {};
	return r.Info = e.read_shift(2), e.l -= 2, r.Info === 1 ? r.Data = Bs(e, t) : r.Data = zs(e, t), r;
}
function qs(e, t, n) {
	var r = { Type: n.biff >= 8 ? e.read_shift(2) : 0 };
	return r.Type ? Ks(e, t - 2, r) : Gs(e, n.biff >= 8 ? t : t - 2, n, r), r;
}
function Js(e, t) {
	switch (t.type) {
		case "base64": return Ys(S(e), t);
		case "binary": return Ys(e, t);
		case "buffer": return Ys(C && Buffer.isBuffer(e) ? e.toString("binary") : k(e), t);
		case "array": return Ys(ht(e), t);
	}
	throw Error("Unrecognized type " + t.type);
}
function Ys(e, t) {
	var n = t || {}, r = {}, i = n.dense;
	i && (r["!data"] = []);
	var a = jt(e, "\\trowd", "\\row");
	if (!a) throw Error("RTF missing table");
	var o = {
		s: {
			c: 0,
			r: 0
		},
		e: {
			c: 0,
			r: a.length - 1
		}
	}, s = [];
	return a.forEach(function(e, t) {
		i && (s = r["!data"][t] = []);
		for (var a = /\\[\w\-]+\b/g, c = 0, l, u = -1, d = []; (l = a.exec(e)) != null;) {
			var f = e.slice(c, a.lastIndex - l[0].length);
			switch (f.charCodeAt(0) == 32 && (f = f.slice(1)), f.length && d.push(f), l[0]) {
				case "\\cell":
					if (++u, d.length) {
						var p = {
							v: d.join(""),
							t: "s"
						};
						p.v == "TRUE" || p.v == "FALSE" ? (p.v = p.v == "TRUE", p.t = "b") : isNaN(vt(p.v)) ? Di[p.v] != null && (p.t = "e", p.w = p.v, p.v = Di[p.v]) : (p.t = "n", n.cellText !== !1 && (p.w = p.v), p.v = vt(p.v)), i ? s[u] = p : r[Y({
							r: t,
							c: u
						})] = p;
					}
					d = [];
					break;
				case "\\par":
					d.push("\n");
					break;
			}
			c = a.lastIndex;
		}
		u > o.e.c && (o.e.c = u);
	}), r["!ref"] = X(o), r;
}
function Xs(e, t) {
	var n = Lr(Js(e, t), t);
	return n.bookType = "rtf", n;
}
function Zs(e) {
	var t = e.slice(+(e[0] === "#")).slice(0, 6);
	return [
		parseInt(t.slice(0, 2), 16),
		parseInt(t.slice(2, 4), 16),
		parseInt(t.slice(4, 6), 16)
	];
}
function Qs(e) {
	for (var t = 0, n = 1; t != 3; ++t) n = n * 256 + (e[t] > 255 ? 255 : e[t] < 0 ? 0 : e[t]);
	return n.toString(16).toUpperCase().slice(1);
}
function $s(e) {
	var t = e[0] / 255, n = e[1] / 255, r = e[2] / 255, i = Math.max(t, n, r), a = Math.min(t, n, r), o = i - a;
	if (o === 0) return [
		0,
		0,
		t
	];
	var s = 0, c = 0, l = i + a;
	switch (c = o / (l > 1 ? 2 - l : l), i) {
		case t:
			s = ((n - r) / o + 6) % 6;
			break;
		case n:
			s = (r - t) / o + 2;
			break;
		case r:
			s = (t - n) / o + 4;
			break;
	}
	return [
		s / 6,
		c,
		l / 2
	];
}
function ec(e) {
	var t = e[0], n = e[1], r = e[2], i = n * 2 * (r < .5 ? r : 1 - r), a = r - i / 2, o = [
		a,
		a,
		a
	], s = 6 * t, c;
	if (n !== 0) switch (s | 0) {
		case 0:
		case 6:
			c = i * s, o[0] += i, o[1] += c;
			break;
		case 1:
			c = i * (2 - s), o[0] += c, o[1] += i;
			break;
		case 2:
			c = i * (s - 2), o[1] += i, o[2] += c;
			break;
		case 3:
			c = i * (4 - s), o[1] += c, o[2] += i;
			break;
		case 4:
			c = i * (s - 4), o[2] += i, o[0] += c;
			break;
		case 5:
			c = i * (6 - s), o[2] += c, o[0] += i;
			break;
	}
	for (var l = 0; l != 3; ++l) o[l] = Math.round(o[l] * 255);
	return o;
}
function tc(e, t) {
	if (t === 0) return e;
	var n = $s(Zs(e));
	return t < 0 ? n[2] *= 1 + t : n[2] = 1 - (1 - n[2]) * (1 - t), Qs(ec(n));
}
function nc(e, t) {
	var n = {};
	if (e == null) return n;
	if (e.auto != null && (n.auto = J(e.auto)), e.rgb != null && (n.rgb = e.rgb.slice(-6).toUpperCase()), e.indexed != null) {
		n.indexed = parseInt(e.indexed, 10), n.index = n.indexed;
		var r = Ti[n.indexed];
		n.indexed == 81 && (r = Ti[1]), r || (r = Ti[1]), r && (n.rgb = Qs(r));
	}
	return e.theme != null && (n.theme = parseInt(e.theme, 10), e.tint != null && (n.tint = parseFloat(e.tint)), t && t.themeElements && t.themeElements.clrScheme && t.themeElements.clrScheme[n.theme] && (n.raw_rgb = t.themeElements.clrScheme[n.theme].rgb, n.rgb = tc(n.raw_rgb, n.tint || 0))), e.tint != null && n.tint == null && (n.tint = parseFloat(e.tint)), n;
}
function rc(e, t) {
	if (!e) return e;
	var n = gt(e);
	if (n.rgb && (n.rgb = ("" + n.rgb).slice(-6).toUpperCase()), n.indexed != null && !n.rgb) {
		var r = Ti[n.indexed];
		n.indexed == 81 && (r = Ti[1]), r || (r = Ti[1]), r && (n.rgb = Qs(r));
	}
	return n.index != null && n.indexed == null && (n.indexed = n.index), n.theme != null && t && t.themeElements && t.themeElements.clrScheme && t.themeElements.clrScheme[n.theme] && (n.raw_rgb = t.themeElements.clrScheme[n.theme].rgb, n.rgb = tc(n.raw_rgb, n.tint || 0)), n;
}
function ic(e, t) {
	if (!e) return e;
	var n = gt(e);
	return n.color && (n.color = rc(n.color, t)), n.fgColor && (n.fgColor = rc(n.fgColor, t)), n.bgColor && (n.bgColor = rc(n.bgColor, t)), [
		"left",
		"right",
		"top",
		"bottom",
		"diagonal",
		"horizontal",
		"vertical",
		"start",
		"end"
	].forEach(function(e) {
		n[e] && n[e].color && (n[e].color = rc(n[e].color, t));
	}), n.gradientFill && n.gradientFill.stops && n.gradientFill.stops.forEach(function(e) {
		e.color && (e.color = rc(e.color, t));
	}), n;
}
var ac = 6, oc = 15, sc = 1, cc = ac;
function lc(e) {
	return Math.floor((e + Math.round(128 / cc) / 256) * cc);
}
function uc(e) {
	return Math.floor((e - 5) / cc * 100 + .5) / 100;
}
function dc(e) {
	return Math.round((e * cc + 5) / cc * 256) / 256;
}
function fc(e) {
	return dc(uc(lc(e)));
}
function pc(e) {
	var t = Math.abs(e - fc(e)), n = cc;
	if (t > .005) for (cc = sc; cc < oc; ++cc) Math.abs(e - fc(e)) <= t && (t = Math.abs(e - fc(e)), n = cc);
	cc = n;
}
function mc(e) {
	e.width ? (e.wpx = lc(e.width), e.wch = uc(e.wpx), e.MDW = cc) : e.wpx ? (e.wch = uc(e.wpx), e.width = dc(e.wch), e.MDW = cc) : typeof e.wch == "number" && (e.width = dc(e.wch), e.wpx = lc(e.width), e.MDW = cc), e.customWidth && delete e.customWidth;
}
var hc = 255, gc = 5;
function _c(e) {
	return e > hc ? hc : e < 0 ? 0 : e;
}
function vc(e) {
	return _c(dc(uc(Math.max(0, e))));
}
function yc(e) {
	return e ? e.wpx == null ? e.width == null ? e.wch == null ? 64 : lc(dc(e.wch)) : lc(e.width) : e.wpx : 64;
}
function bc(e, t) {
	return e || (e = {}), e.wpx = Math.max(0, Math.ceil(t)), e.wch = uc(e.wpx), e.width = vc(e.wpx), e.MDW = cc, e.bestFit = !0, e.customWidth = !0, e;
}
function xc(e) {
	var t = +(e && e.font || {}).sz;
	return t > 0 ? t : 11;
}
function Sc(e) {
	return (e && e.font || {}).name || "Calibri";
}
function Cc(e) {
	var t = e && e.font || {}, n = [];
	t.italic && n.push("italic"), t.bold && n.push("bold"), n.push(xc(e) + "pt");
	var r = Sc(e);
	return /[,\s'"]/.test(r) && (r = "\"" + String(r).replace(/"/g, "\\\"") + "\""), n.push(r), n.join(" ");
}
function wc(e, t) {
	var n = e.charCodeAt(0);
	return n == 9 || n == 32 ? t * .33 : n >= 48 && n <= 57 ? t * .52 : n >= 65 && n <= 90 ? t * .62 : n >= 97 && n <= 122 ? "iljtfr".indexOf(e) > -1 ? t * .28 : "mw".indexOf(e) > -1 ? t * .82 : t * .5 : n >= 11904 ? t : t * .52;
}
function Tc(e, t) {
	for (var n = Lc(xc(t)), r = 0, i = 0; i < e.length; ++i) r += wc(e.charAt(i), n);
	return r;
}
function Ec(e, t, n) {
	var r = n || {}, i = (e == null ? "" : String(e)).split(/\r\n|\n|\r/g), a = 0, o = 0, s = 0;
	if (r.measureText) for (o = 0; o < i.length; ++o) s = +r.measureText(i[o], Cc(t), t || {}), isFinite(s) && s > a && (a = s);
	else {
		var c = r.canvas, l = null;
		if (!c && typeof document < "u" && document.createElement) try {
			c = document.createElement("canvas");
		} catch {}
		try {
			l = c && c.getContext && c.getContext("2d");
		} catch {
			l = null;
		}
		if (l && l.measureText) for (l.font = Cc(t), o = 0; o < i.length; ++o) s = l.measureText(i[o]).width, isFinite(s) && s > a && (a = s);
		else for (o = 0; o < i.length; ++o) s = Tc(i[o], t || {}), isFinite(s) && s > a && (a = s);
	}
	return a;
}
function Dc(e, t) {
	return !e || e.v == null ? "" : (e.w == null && e.t != "z" && Ir(e), String(e.w == null ? e.v : e.w));
}
function Oc(e, t) {
	var n = String(e == null ? "" : e).split(/\r\n|\n|\r/g), r = [], i = 0, a = 0, o = null;
	if (!t) return n;
	for (i = 0; i < n.length; ++i) {
		for (o = n[i].split(/[\t \u00A0\-\/]+/), a = 0; a < o.length; ++a) o[a] && r.push(o[a]);
		(!o.length || o.length == 1 && !o[0]) && r.push(n[i]);
	}
	return r.length ? r : [""];
}
function kc(e, t, n, r) {
	var i = {}, a = e["!cols"] || [], o = e["!rows"] || [];
	return a[r] && a[r].s && nf(i, a[r].s), o[n] && o[n].s && nf(i, o[n].s), t && t.s && nf(i, t.s), i;
}
function Ac(e, t, n) {
	for (var r = n || {}, i = Dc(e, r), a = t && t.alignment || {}, o = Oc(i, !!a.wrapText), s = 0, c = 0, l = 0; l < o.length; ++l) c = Ec(o[l], t, r), c > s && (s = c);
	var u = +a.indent || 0;
	u > 0 && (s += u * 3 * Math.max(1, cc));
	var d = +a.textRotation || 0;
	if (d == 255 && (d = 90), d > 90 && (d = 90 - d), d < 0 && (d = -d), d > 0 && d < 90) {
		var f = d * Math.PI / 180, p = Lc(xc(t));
		s = Math.abs(s * Math.cos(f)) + Math.abs(p * Math.sin(f));
	} else d >= 90 && (s = Math.max(cc + gc, Lc(xc(t)) + 2));
	return s + (r.padding == null ? gc : +r.padding);
}
function jc(e) {
	for (var t = {}, n = 0; n < e.length; ++n) t[e[n].s.r + ":" + e[n].s.c] = e[n];
	return t;
}
function Mc(e, t, n) {
	for (var r = 0; r < e.length; ++r) {
		var i = e[r];
		if (i.s.r <= t && t <= i.e.r && i.s.c <= n && n <= i.e.c) return !(i.s.r == t && i.s.c == n);
	}
	return !1;
}
function Nc(e, t) {
	var n = t || {}, r = cc;
	n.MDW && (cc = +n.MDW || cc);
	var i = n.range ? typeof n.range == "string" ? Mr(n.range) : n.range : Mr(e["!ref"] || "A1"), a = e["!cols"] || [], o = e["!rows"] || [], s = [], c = [], l = n.minPx == null ? n.min == null ? 0 : lc(dc(+n.min)) : +n.minPx, u = n.maxPx == null ? lc(hc) : +n.maxPx, d = n.includeMerged === !1 ? [] : e["!merges"] || [], f = jc(d), p = e["!data"] != null, m = 0, h = 0, g = 0, _ = null, v = 0, y = null, b = null, x = 0, S = 0;
	for (m = i.s.c; m <= i.e.c; ++m) s[m] = gt(a[m] || {}), !(s[m] && s[m].hidden && n.skipHidden) && (c[m] = s[m] && (s[m].wpx != null || s[m].width != null || s[m].wch != null) ? yc(s[m]) : l);
	for (h = i.s.r; h <= i.e.r; ++h) if (!(o[h] && o[h].hidden && n.skipHidden)) {
		for (m = i.s.c; m <= i.e.c; ++m) if (!(s[m] && s[m].hidden && n.skipHidden) && !Mc(d, h, m) && (y = p ? (e["!data"][h] || [])[m] : e[Y({
			r: h,
			c: m
		})], !(!y || y.v == null))) if (b = kc(e, y, h, m), x = Ac(y, b, n), b && b.alignment && b.alignment.shrinkToFit && c[m] && (x = Math.min(x, c[m])), _ = f[h + ":" + m], g = _ ? _.e.c - _.s.c + 1 : 1, g > 1) {
			for (S = 0, v = 0; v < g; ++v) S += c[m + v] || l;
			if (x > S) for (v = 0; v < g; ++v) c[m + v] = Math.min(u, Math.max(c[m + v] || l, (c[m + v] || l) + (x - S) / g));
		} else c[m] = Math.min(u, Math.max(c[m] || l, x));
	}
	for (m = i.s.c; m <= i.e.c; ++m) c[m] != null && (s[m] = bc(s[m] || {}, Math.min(u, Math.max(l, c[m]))));
	return n.set === !1 ? (cc = r, s) : (e["!cols"] = s, cc = r, s);
}
var Pc = 96;
function Fc(e) {
	return e * 96 / Pc;
}
function Ic(e) {
	return e * Pc / 96;
}
function Lc(e) {
	return e * 96 / 72;
}
function Rc(e) {
	return e * 72 / 96;
}
var zc = {
	None: "none",
	Solid: "solid",
	Gray50: "mediumGray",
	Gray75: "darkGray",
	Gray25: "lightGray",
	HorzStripe: "darkHorizontal",
	VertStripe: "darkVertical",
	ReverseDiagStripe: "darkDown",
	DiagStripe: "darkUp",
	DiagCross: "darkGrid",
	ThickDiagCross: "darkTrellis",
	ThinHorzStripe: "lightHorizontal",
	ThinVertStripe: "lightVertical",
	ThinReverseDiagStripe: "lightDown",
	ThinHorzCross: "lightGrid"
};
function Bc(e, t, n, r) {
	t.Borders = [];
	var i = {}, a = "", o = !1;
	(e.match(en) || []).forEach(function(e) {
		var s = K(e);
		switch (an(s[0])) {
			case "<borders":
			case "<borders>":
			case "</borders>": break;
			case "<border":
			case "<border>":
			case "<border/>":
				i = {}, s.diagonalUp && (i.diagonalUp = J(s.diagonalUp)), s.diagonalDown && (i.diagonalDown = J(s.diagonalDown)), t.Borders.push(i);
				break;
			case "</border>": break;
			case "<left/>":
				i.left = {}, s.style && (i.left.style = s.style);
				break;
			case "<left":
			case "<left>":
				a = "left", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</left>":
				a = "";
				break;
			case "<right/>":
				i.right = {}, s.style && (i.right.style = s.style);
				break;
			case "<right":
			case "<right>":
				a = "right", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</right>":
				a = "";
				break;
			case "<top/>":
				i.top = {}, s.style && (i.top.style = s.style);
				break;
			case "<top":
			case "<top>":
				a = "top", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</top>":
				a = "";
				break;
			case "<bottom/>":
				i.bottom = {}, s.style && (i.bottom.style = s.style);
				break;
			case "<bottom":
			case "<bottom>":
				a = "bottom", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</bottom>":
				a = "";
				break;
			case "<diagonal/>":
				i.diagonal = {}, s.style && (i.diagonal.style = s.style);
				break;
			case "<diagonal":
			case "<diagonal>":
				a = "diagonal", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</diagonal>":
				a = "";
				break;
			case "<horizontal/>":
				i.horizontal = {}, s.style && (i.horizontal.style = s.style);
				break;
			case "<horizontal":
			case "<horizontal>":
				a = "horizontal", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</horizontal>":
				a = "";
				break;
			case "<vertical/>":
				i.vertical = {}, s.style && (i.vertical.style = s.style);
				break;
			case "<vertical":
			case "<vertical>":
				a = "vertical", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</vertical>":
				a = "";
				break;
			case "<start/>":
				i.start = {}, s.style && (i.start.style = s.style);
				break;
			case "<start":
			case "<start>":
				a = "start", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</start>":
				a = "";
				break;
			case "<end/>":
				i.end = {}, s.style && (i.end.style = s.style);
				break;
			case "<end":
			case "<end>":
				a = "end", i[a] = i[a] || {}, s.style && (i[a].style = s.style);
				break;
			case "</end>":
				a = "";
				break;
			case "<color":
			case "<color>":
				a && (i[a].color = nc(s, n));
				break;
			case "<color/>":
			case "</color>": break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>": break;
			case "<ext":
				o = !0;
				break;
			case "</ext>":
				o = !1;
				break;
			default: if (r && r.WTF && !o) throw Error("unrecognized " + s[0] + " in borders");
		}
	});
}
function Vc(e, t, n, r) {
	t.Fills = [];
	var i = {}, a = null, o = null, s = !1;
	(e.match(en) || []).forEach(function(e) {
		var c = K(e);
		switch (an(c[0])) {
			case "<fills":
			case "<fills>":
			case "</fills>": break;
			case "<fill>":
			case "<fill":
			case "<fill/>":
				i = {}, t.Fills.push(i);
				break;
			case "</fill>": break;
			case "<gradientFill>":
				a = { stops: [] }, i.gradientFill = a;
				break;
			case "<gradientFill":
				a = { stops: [] }, c.type && (a.type = c.type), c.degree && (a.degree = parseFloat(c.degree)), [
					"left",
					"right",
					"top",
					"bottom"
				].forEach(function(e) {
					c[e] != null && (a[e] = parseFloat(c[e]));
				}), i.gradientFill = a;
				break;
			case "</gradientFill>":
				a = null;
				break;
			case "<patternFill":
			case "<patternFill>":
				c.patternType && (i.patternType = c.patternType);
				break;
			case "<patternFill/>":
			case "</patternFill>": break;
			case "<bgColor":
				i.bgColor = nc(c, n);
				break;
			case "<bgColor/>":
			case "</bgColor>": break;
			case "<fgColor":
				i.fgColor = nc(c, n);
				break;
			case "<fgColor/>":
			case "</fgColor>": break;
			case "<stop":
				o = {}, c.position != null && (o.position = parseFloat(c.position)), a && a.stops.push(o);
				break;
			case "<stop/>":
				a && (o = {}, c.position != null && (o.position = parseFloat(c.position)), a.stops.push(o)), o = null;
				break;
			case "</stop>":
				o = null;
				break;
			case "<color":
				o && (o.color = nc(c, n));
				break;
			case "<color/>":
				o && (o.color = nc(c, n));
				break;
			case "</color>": break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>": break;
			case "<ext":
				s = !0;
				break;
			case "</ext>":
				s = !1;
				break;
			default: if (r && r.WTF && !s) throw Error("unrecognized " + c[0] + " in fills");
		}
	});
}
function Hc(e, t, n, r) {
	t.Fonts = [];
	var i = {}, o = !1;
	(e.match(en) || []).forEach(function(e) {
		var s = K(e);
		switch (an(s[0])) {
			case "<fonts":
			case "<fonts>":
			case "</fonts>": break;
			case "<font":
			case "<font>": break;
			case "</font>":
			case "<font/>":
				t.Fonts.push(i), i = {};
				break;
			case "<name":
				s.val && (i.name = vn(s.val));
				break;
			case "<name/>":
			case "</name>": break;
			case "<b":
				i.bold = s.val ? J(s.val) : 1;
				break;
			case "<b/>":
				i.bold = 1;
				break;
			case "</b>":
			case "</b": break;
			case "<i":
				i.italic = s.val ? J(s.val) : 1;
				break;
			case "<i/>":
				i.italic = 1;
				break;
			case "</i>":
			case "</i": break;
			case "<u":
				switch (s.val) {
					case "none":
						i.underline = 0;
						break;
					case "single":
						i.underline = 1;
						break;
					case "double":
						i.underline = 2;
						break;
					case "singleAccounting":
						i.underline = 33;
						break;
					case "doubleAccounting":
						i.underline = 34;
						break;
				}
				break;
			case "<u/>":
				i.underline = 1;
				break;
			case "</u>":
			case "</u": break;
			case "<strike":
				i.strike = s.val ? J(s.val) : 1;
				break;
			case "<strike/>":
				i.strike = 1;
				break;
			case "</strike>":
			case "</strike": break;
			case "<outline":
				i.outline = s.val ? J(s.val) : 1;
				break;
			case "<outline/>":
				i.outline = 1;
				break;
			case "</outline>":
			case "</outline": break;
			case "<shadow":
				i.shadow = s.val ? J(s.val) : 1;
				break;
			case "<shadow/>":
				i.shadow = 1;
				break;
			case "</shadow>":
			case "</shadow": break;
			case "<condense":
				i.condense = s.val ? J(s.val) : 1;
				break;
			case "<condense/>":
				i.condense = 1;
				break;
			case "</condense>":
			case "</condense": break;
			case "<extend":
				i.extend = s.val ? J(s.val) : 1;
				break;
			case "<extend/>":
				i.extend = 1;
				break;
			case "</extend>":
			case "</extend": break;
			case "<sz":
				s.val && (i.sz = +s.val);
				break;
			case "<sz/>":
			case "</sz>":
			case "</sz": break;
			case "<vertAlign":
				s.val && (i.vertAlign = s.val);
				break;
			case "<vertAlign/>":
			case "</vertAlign>":
			case "</vertAlign": break;
			case "<family":
				s.val && (i.family = parseInt(s.val, 10));
				break;
			case "<family/>":
			case "</family>":
			case "</family": break;
			case "<scheme":
				s.val && (i.scheme = s.val);
				break;
			case "<scheme/>":
			case "</scheme>":
			case "</scheme": break;
			case "<charset":
				if (s.val == "1") break;
				s.codepage = a[parseInt(s.val, 10)];
				break;
			case "<charset/>":
			case "</charset>":
			case "</charset": break;
			case "<color":
				i.color = nc(s, n);
				break;
			case "<color/>":
			case "</color>":
			case "</color": break;
			case "<AlternateContent":
				o = !0;
				break;
			case "</AlternateContent>":
			case "</AlternateContent":
				o = !1;
				break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>": break;
			case "<ext":
				o = !0;
				break;
			case "</ext>":
				o = !1;
				break;
			default: if (r && r.WTF && !o) throw Error("unrecognized " + s[0] + " in fonts");
		}
	});
}
function Uc(e, t, n) {
	t.NumberFmt = [];
	for (var r = rt(V), i = 0; i < r.length; ++i) t.NumberFmt[r[i]] = V[r[i]];
	var a = e.match(en);
	if (a) for (i = 0; i < a.length; ++i) {
		var o = K(a[i]);
		switch (an(o[0])) {
			case "<numFmts":
			case "</numFmts>":
			case "<numFmts/>":
			case "<numFmts>": break;
			case "<numFmt":
				var s = q(vn(o.formatCode)), c = parseInt(o.numFmtId, 10);
				if (t.NumberFmt[c] = s, c > 0) {
					if (c > 392) {
						for (c = 392; c > 60 && t.NumberFmt[c] != null; --c);
						t.NumberFmt[c] = s;
					}
					Qe(s, c);
				}
				break;
			case "</numFmt>": break;
			default: if (n.WTF) throw Error("unrecognized " + o[0] + " in numFmts");
		}
	}
}
var Wc = [
	"numFmtId",
	"fillId",
	"fontId",
	"borderId",
	"xfId"
], Gc = [
	"applyAlignment",
	"applyBorder",
	"applyFill",
	"applyFont",
	"applyNumberFormat",
	"applyProtection",
	"pivotButton",
	"quotePrefix"
];
function Kc(e, t, n, r) {
	t[r] = [];
	var i, a = !1;
	(e.match(en) || []).forEach(function(e) {
		var o = K(e), s = 0;
		switch (an(o[0])) {
			case "<cellXfs":
			case "<cellXfs>":
			case "<cellXfs/>":
			case "</cellXfs>":
			case "<cellStyleXfs":
			case "<cellStyleXfs>":
			case "<cellStyleXfs/>":
			case "</cellStyleXfs>": break;
			case "<xf":
			case "<xf/>":
			case "<xf>":
				for (i = o, delete i[0], s = 0; s < Wc.length; ++s) i[Wc[s]] && (i[Wc[s]] = parseInt(i[Wc[s]], 10));
				for (s = 0; s < Gc.length; ++s) i[Gc[s]] && (i[Gc[s]] = J(i[Gc[s]]));
				if (t.NumberFmt && i.numFmtId > 392) {
					for (s = 392; s > 60; --s) if (t.NumberFmt[i.numFmtId] == t.NumberFmt[s]) {
						i.numFmtId = s;
						break;
					}
				}
				t[r].push(i);
				break;
			case "</xf>": break;
			case "<alignment":
			case "<alignment/>":
			case "<alignment>":
				var c = {};
				o.vertical && (c.vertical = o.vertical), o.horizontal && (c.horizontal = o.horizontal), o.textRotation != null && (c.textRotation = parseInt(o.textRotation, 10)), o.indent && (c.indent = parseInt(o.indent, 10)), o.relativeIndent && (c.relativeIndent = parseInt(o.relativeIndent, 10)), o.readingOrder && (c.readingOrder = parseInt(o.readingOrder, 10)), o.wrapText && (c.wrapText = J(o.wrapText)), o.shrinkToFit && (c.shrinkToFit = J(o.shrinkToFit)), o.justifyLastLine && (c.justifyLastLine = J(o.justifyLastLine)), i.alignment = c;
				break;
			case "</alignment>": break;
			case "<protection":
			case "<protection>":
				var l = {};
				o.locked != null && (l.locked = J(o.locked)), o.hidden != null && (l.hidden = J(o.hidden)), i.protection = l;
				break;
			case "<protection/>":
				l = {}, o.locked != null && (l.locked = J(o.locked)), o.hidden != null && (l.hidden = J(o.hidden)), i.protection = l;
				break;
			case "</protection>": break;
			case "<AlternateContent":
			case "<AlternateContent>":
				a = !0;
				break;
			case "</AlternateContent>":
				a = !1;
				break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>": break;
			case "<ext":
				a = !0;
				break;
			case "</ext>":
				a = !1;
				break;
			default: if (n && n.WTF && !a) throw Error("unrecognized " + o[0] + " in cellXfs");
		}
	});
}
function qc(e, t, n) {
	Kc(e, t, n, "CellXf");
}
function Jc(e, t, n) {
	Kc(e, t, n, "CellStyleXf");
}
function Yc(e, t, n) {
	t.CellStyles = [], (e.match(en) || []).forEach(function(e) {
		var r = K(e);
		switch (an(r[0])) {
			case "<cellStyles":
			case "<cellStyles>":
			case "<cellStyles/>":
			case "</cellStyles>": break;
			case "<cellStyle":
			case "<cellStyle/>":
				delete r[0], r.xfId != null && (r.xfId = parseInt(r.xfId, 10)), r.builtinId != null && (r.builtinId = parseInt(r.builtinId, 10)), r.iLevel != null && (r.iLevel = parseInt(r.iLevel, 10)), r.customBuiltin != null && (r.customBuiltin = J(r.customBuiltin)), r.hidden != null && (r.hidden = J(r.hidden)), r.name && (r.name = vn(r.name)), t.CellStyles.push(r);
				break;
			case "</cellStyle>": break;
			default: if (n && n.WTF) throw Error("unrecognized " + r[0] + " in cellStyles");
		}
	});
}
function Xc(e, t, n, r) {
	t.Dxfs = [];
	var i = null, a = null, o = null, s = null, c = "", l = !1;
	(e.match(en) || []).forEach(function(e) {
		var u = K(e);
		switch (an(u[0])) {
			case "<dxfs":
			case "<dxfs>":
			case "<dxfs/>":
			case "</dxfs>": break;
			case "<dxf":
			case "<dxf>":
				i = {}, t.Dxfs.push(i);
				break;
			case "<dxf/>":
				t.Dxfs.push({}), i = null;
				break;
			case "</dxf>":
				i = null;
				break;
			case "<font":
			case "<font>":
				a = {}, i && (i.font = a);
				break;
			case "</font>":
			case "<font/>":
				a = null;
				break;
			case "<name":
				a && u.val && (a.name = vn(u.val));
				break;
			case "<name/>":
			case "</name>": break;
			case "<b":
				a && (a.bold = u.val ? J(u.val) : 1);
				break;
			case "<b/>":
				a && (a.bold = 1);
				break;
			case "</b>": break;
			case "<i":
				a && (a.italic = u.val ? J(u.val) : 1);
				break;
			case "<i/>":
				a && (a.italic = 1);
				break;
			case "</i>": break;
			case "<u":
				a && (a.underline = u.val || 1);
				break;
			case "<u/>":
				a && (a.underline = 1);
				break;
			case "</u>": break;
			case "<strike":
				a && (a.strike = u.val ? J(u.val) : 1);
				break;
			case "<strike/>":
				a && (a.strike = 1);
				break;
			case "</strike>": break;
			case "<sz":
				a && u.val && (a.sz = +u.val);
				break;
			case "<sz/>":
			case "</sz>": break;
			case "<outline":
				a && (a.outline = u.val ? J(u.val) : 1);
				break;
			case "<outline/>":
				a && (a.outline = 1);
				break;
			case "</outline>": break;
			case "<shadow":
				a && (a.shadow = u.val ? J(u.val) : 1);
				break;
			case "<shadow/>":
				a && (a.shadow = 1);
				break;
			case "</shadow>": break;
			case "<condense":
				a && (a.condense = u.val ? J(u.val) : 1);
				break;
			case "<condense/>":
				a && (a.condense = 1);
				break;
			case "</condense>": break;
			case "<extend":
				a && (a.extend = u.val ? J(u.val) : 1);
				break;
			case "<extend/>":
				a && (a.extend = 1);
				break;
			case "</extend>": break;
			case "<vertAlign":
				a && u.val && (a.vertAlign = u.val);
				break;
			case "<vertAlign/>":
			case "</vertAlign>": break;
			case "<family":
				a && u.val && (a.family = parseInt(u.val, 10));
				break;
			case "<family/>":
			case "</family>": break;
			case "<scheme":
				a && u.val && (a.scheme = u.val);
				break;
			case "<scheme/>":
			case "</scheme>": break;
			case "<charset":
				a && u.val != null && (a.charset = parseInt(u.val, 10));
				break;
			case "<charset/>":
			case "</charset>": break;
			case "<color":
				a ? a.color = nc(u, n) : c && s && (s[c].color = nc(u, n));
				break;
			case "<color/>":
			case "</color>": break;
			case "<fill":
			case "<fill>":
				o = {}, i && (i.fill = o);
				break;
			case "<fill/>":
				o = null;
				break;
			case "</fill>":
				o = null;
				break;
			case "<patternFill":
			case "<patternFill>":
				o && u.patternType && (o.patternType = u.patternType);
				break;
			case "<patternFill/>":
			case "</patternFill>": break;
			case "<fgColor":
				o && (o.fgColor = nc(u, n));
				break;
			case "<fgColor/>":
			case "</fgColor>": break;
			case "<bgColor":
				o && (o.bgColor = nc(u, n));
				break;
			case "<bgColor/>":
			case "</bgColor>": break;
			case "<border":
			case "<border>":
				s = {}, i && (i.border = s);
				break;
			case "<border/>":
				s = null;
				break;
			case "</border>":
				s = null;
				break;
			case "<left":
			case "<left>":
			case "<left/>":
				c = "left", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</left>":
				c = "";
				break;
			case "<right":
			case "<right>":
			case "<right/>":
				c = "right", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</right>":
				c = "";
				break;
			case "<top":
			case "<top>":
			case "<top/>":
				c = "top", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</top>":
				c = "";
				break;
			case "<bottom":
			case "<bottom>":
			case "<bottom/>":
				c = "bottom", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</bottom>":
				c = "";
				break;
			case "<diagonal":
			case "<diagonal>":
			case "<diagonal/>":
				c = "diagonal", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</diagonal>":
				c = "";
				break;
			case "<horizontal":
			case "<horizontal>":
			case "<horizontal/>":
				c = "horizontal", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</horizontal>":
				c = "";
				break;
			case "<vertical":
			case "<vertical>":
			case "<vertical/>":
				c = "vertical", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</vertical>":
				c = "";
				break;
			case "<start":
			case "<start>":
			case "<start/>":
				c = "start", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</start>":
				c = "";
				break;
			case "<end":
			case "<end>":
			case "<end/>":
				c = "end", s && (s[c] = s[c] || {}, u.style && (s[c].style = u.style)), u[0].slice(-2) == "/>" && (c = "");
				break;
			case "</end>":
				c = "";
				break;
			case "<alignment":
				i && (i.alignment = {}, u.vertical && (i.alignment.vertical = u.vertical), u.horizontal && (i.alignment.horizontal = u.horizontal), u.wrapText && (i.alignment.wrapText = J(u.wrapText)));
				break;
			case "<alignment/>":
			case "</alignment>": break;
			case "<numFmt":
				i && (i.numFmt = {
					numFmtId: u.numFmtId == null ? void 0 : parseInt(u.numFmtId, 10),
					formatCode: u.formatCode ? q(vn(u.formatCode)) : void 0
				});
				break;
			case "<numFmt/>":
			case "</numFmt>": break;
			case "<protection":
				i && (i.protection = {}, u.locked != null && (i.protection.locked = J(u.locked)), u.hidden != null && (i.protection.hidden = J(u.hidden)));
				break;
			case "<protection/>":
			case "</protection>": break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>": break;
			case "<ext":
				l = !0;
				break;
			case "</ext>":
				l = !1;
				break;
			default: if (r && r.WTF && !l) throw Error("unrecognized " + u[0] + " in dxfs");
		}
	});
}
function Zc(e, t, n, r) {
	t.Colors = {
		indexedColors: [],
		mruColors: [],
		themeColors: []
	};
	var i = null, a = !1;
	(e.match(en) || []).forEach(function(e) {
		var o = K(e);
		switch (an(o[0])) {
			case "<colors":
			case "<colors>":
			case "</colors>": break;
			case "<indexedColors":
			case "<indexedColors>":
				i = t.Colors.indexedColors;
				break;
			case "</indexedColors>":
				i = null;
				break;
			case "<themeColors":
			case "<themeColors>":
				i = t.Colors.themeColors;
				break;
			case "</themeColors>":
				i = null;
				break;
			case "<mruColors":
			case "<mruColors>":
				i = t.Colors.mruColors;
				break;
			case "</mruColors>":
				i = null;
				break;
			case "<rgbColor":
			case "<rgbColor/>":
				i && i.push(nc(o, n));
				break;
			case "</rgbColor>": break;
			case "<color":
			case "<color/>":
				i && i.push(nc(o, n));
				break;
			case "</color>": break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>": break;
			case "<ext":
				a = !0;
				break;
			case "</ext>":
				a = !1;
				break;
			default: if (r && r.WTF && !a) throw Error("unrecognized " + o[0] + " in colors");
		}
	});
}
var Qc = /*#__PURE__*/ (function() {
	return function(e, t, n) {
		var r = {};
		if (!e) return r;
		e = At(Mt(e, "<!--", "-->"));
		var i;
		return (i = Ft(e, "numFmts")) && Uc(i[0], r, n), (i = Ft(e, "fonts")) && Hc(i[0], r, t, n), (i = Ft(e, "fills")) && Vc(i[0], r, t, n), (i = Ft(e, "borders")) && Bc(i[0], r, t, n), (i = Ft(e, "cellStyleXfs")) && Jc(i[0], r, n), (i = Ft(e, "cellStyles")) && Yc(i[0], r, n), (i = Ft(e, "cellXfs")) && qc(i[0], r, n), (i = Ft(e, "dxfs")) && Xc(i[0], r, t, n), (i = Ft(e, "colors")) && Zc(i[0], r, t, n), r;
	};
})();
function $c(e, t) {
	return [e.read_shift(2), Hr(e, t - 2)];
}
function el(e, t, n) {
	var r = {};
	r.sz = e.read_shift(2) / 20;
	var i = ri(e, 2, n);
	switch (i.fItalic && (r.italic = 1), i.fCondense && (r.condense = 1), i.fExtend && (r.extend = 1), i.fShadow && (r.shadow = 1), i.fOutline && (r.outline = 1), i.fStrikeout && (r.strike = 1), e.read_shift(2) === 700 && (r.bold = 1), e.read_shift(2)) {
		case 1:
			r.vertAlign = "superscript";
			break;
		case 2:
			r.vertAlign = "subscript";
			break;
	}
	var a = e.read_shift(1);
	a != 0 && (r.underline = a);
	var o = e.read_shift(1);
	o > 0 && (r.family = o);
	var s = e.read_shift(1);
	switch (s > 0 && (r.charset = s), e.l++, r.color = ni(e, 8), e.read_shift(1)) {
		case 1:
			r.scheme = "major";
			break;
		case 2:
			r.scheme = "minor";
			break;
	}
	return r.name = Hr(e, t - 21), r;
}
var tl = mr;
function nl(e, t) {
	var n = e.l + t, r = e.read_shift(2), i = e.read_shift(2);
	return e.l = n, {
		ixfe: r,
		numFmtId: i
	};
}
var rl = mr;
function il(e, t, n) {
	var r = {};
	for (var i in r.NumberFmt = [], V) r.NumberFmt[i] = V[i];
	r.CellXf = [], r.Fonts = [];
	var a = [], o = !1;
	return gr(e, function(e, i, s) {
		switch (s) {
			case 44:
				r.NumberFmt[e[0]] = e[1], Qe(e[1], e[0]);
				break;
			case 43:
				r.Fonts.push(e), e.color.theme != null && t && t.themeElements && t.themeElements.clrScheme && (e.color.rgb = tc(t.themeElements.clrScheme[e.color.theme].rgb, e.color.tint || 0));
				break;
			case 1025: break;
			case 45: break;
			case 46: break;
			case 47:
				a[a.length - 1] == 617 && r.CellXf.push(e);
				break;
			case 48:
			case 507:
			case 572:
			case 475: break;
			case 1171:
			case 2102:
			case 1130:
			case 512:
			case 2095:
			case 3072: break;
			case 35:
				o = !0;
				break;
			case 36:
				o = !1;
				break;
			case 37:
				a.push(s), o = !0;
				break;
			case 38:
				a.pop(), o = !1;
				break;
			default: if (i.T > 0) a.push(s);
			else if (i.T < 0) a.pop();
			else if (!o || n.WTF && a[a.length - 1] != 37) throw Error("Unexpected record 0x" + s.toString(16));
		}
	}), r;
}
var al = [
	"</a:lt1>",
	"</a:dk1>",
	"</a:lt2>",
	"</a:dk2>",
	"</a:accent1>",
	"</a:accent2>",
	"</a:accent3>",
	"</a:accent4>",
	"</a:accent5>",
	"</a:accent6>",
	"</a:hlink>",
	"</a:folHlink>"
];
function ol(e, t, n) {
	t.themeElements.clrScheme = [];
	var r = {};
	(e[0].match(en) || []).forEach(function(e) {
		var i = K(e);
		switch (i[0]) {
			case "<a:clrScheme":
			case "</a:clrScheme>": break;
			case "<a:srgbClr":
				r.rgb = i.val;
				break;
			case "</a:srgbClr>": break;
			case "<a:sysClr":
				r.rgb = i.lastClr;
				break;
			case "</a:sysClr>": break;
			case "</a:dk1>":
			case "</a:lt1>":
			case "<a:dk1>":
			case "<a:lt1>":
			case "<a:dk2>":
			case "</a:dk2>":
			case "<a:lt2>":
			case "</a:lt2>":
			case "<a:accent1>":
			case "</a:accent1>":
			case "<a:accent2>":
			case "</a:accent2>":
			case "<a:accent3>":
			case "</a:accent3>":
			case "<a:accent4>":
			case "</a:accent4>":
			case "<a:accent5>":
			case "</a:accent5>":
			case "<a:accent6>":
			case "</a:accent6>":
			case "<a:hlink>":
			case "</a:hlink>":
			case "<a:folHlink>":
			case "</a:folHlink>":
				i[0].charAt(1) === "/" ? (t.themeElements.clrScheme[al.indexOf(i[0])] = r, r = {}) : r.name = i[0].slice(3, i[0].length - 1);
				break;
			default: if (n && n.WTF) throw Error("Unrecognized " + i[0] + " in clrScheme");
		}
	});
}
function sl(e, t, n) {
	t.themeElements = {};
	var r;
	if (!(r = Pt(e, "a:clrScheme"))) throw Error("clrScheme not found in themeElements");
	if (ol(r, t, n), !(r = Pt(e, "a:fontScheme"))) throw Error("fontScheme not found in themeElements");
	if (!(r = Pt(e, "a:fmtScheme"))) throw Error("fmtScheme not found in themeElements");
}
function cl(e, t) {
	(!e || e.length === 0) && (e = ll());
	var n, r = {};
	if (!(n = Pt(e, "a:themeElements"))) throw Error("themeElements not found in theme");
	return sl(n[0], r, t), r.raw = e, r;
}
function ll(e, t) {
	if (t && t.themeXLSX) return t.themeXLSX;
	if (e && typeof e.raw == "string") return e.raw;
	var n = [Zt];
	return n[n.length] = "<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office Theme\">", n[n.length] = "<a:themeElements>", n[n.length] = "<a:clrScheme name=\"Office\">", n[n.length] = "<a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1>", n[n.length] = "<a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1>", n[n.length] = "<a:dk2><a:srgbClr val=\"1F497D\"/></a:dk2>", n[n.length] = "<a:lt2><a:srgbClr val=\"EEECE1\"/></a:lt2>", n[n.length] = "<a:accent1><a:srgbClr val=\"4F81BD\"/></a:accent1>", n[n.length] = "<a:accent2><a:srgbClr val=\"C0504D\"/></a:accent2>", n[n.length] = "<a:accent3><a:srgbClr val=\"9BBB59\"/></a:accent3>", n[n.length] = "<a:accent4><a:srgbClr val=\"8064A2\"/></a:accent4>", n[n.length] = "<a:accent5><a:srgbClr val=\"4BACC6\"/></a:accent5>", n[n.length] = "<a:accent6><a:srgbClr val=\"F79646\"/></a:accent6>", n[n.length] = "<a:hlink><a:srgbClr val=\"0000FF\"/></a:hlink>", n[n.length] = "<a:folHlink><a:srgbClr val=\"800080\"/></a:folHlink>", n[n.length] = "</a:clrScheme>", n[n.length] = "<a:fontScheme name=\"Office\">", n[n.length] = "<a:majorFont>", n[n.length] = "<a:latin typeface=\"Cambria\"/>", n[n.length] = "<a:ea typeface=\"\"/>", n[n.length] = "<a:cs typeface=\"\"/>", n[n.length] = "<a:font script=\"Jpan\" typeface=\"ＭＳ Ｐゴシック\"/>", n[n.length] = "<a:font script=\"Hang\" typeface=\"맑은 고딕\"/>", n[n.length] = "<a:font script=\"Hans\" typeface=\"宋体\"/>", n[n.length] = "<a:font script=\"Hant\" typeface=\"新細明體\"/>", n[n.length] = "<a:font script=\"Arab\" typeface=\"Times New Roman\"/>", n[n.length] = "<a:font script=\"Hebr\" typeface=\"Times New Roman\"/>", n[n.length] = "<a:font script=\"Thai\" typeface=\"Tahoma\"/>", n[n.length] = "<a:font script=\"Ethi\" typeface=\"Nyala\"/>", n[n.length] = "<a:font script=\"Beng\" typeface=\"Vrinda\"/>", n[n.length] = "<a:font script=\"Gujr\" typeface=\"Shruti\"/>", n[n.length] = "<a:font script=\"Khmr\" typeface=\"MoolBoran\"/>", n[n.length] = "<a:font script=\"Knda\" typeface=\"Tunga\"/>", n[n.length] = "<a:font script=\"Guru\" typeface=\"Raavi\"/>", n[n.length] = "<a:font script=\"Cans\" typeface=\"Euphemia\"/>", n[n.length] = "<a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/>", n[n.length] = "<a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/>", n[n.length] = "<a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/>", n[n.length] = "<a:font script=\"Thaa\" typeface=\"MV Boli\"/>", n[n.length] = "<a:font script=\"Deva\" typeface=\"Mangal\"/>", n[n.length] = "<a:font script=\"Telu\" typeface=\"Gautami\"/>", n[n.length] = "<a:font script=\"Taml\" typeface=\"Latha\"/>", n[n.length] = "<a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/>", n[n.length] = "<a:font script=\"Orya\" typeface=\"Kalinga\"/>", n[n.length] = "<a:font script=\"Mlym\" typeface=\"Kartika\"/>", n[n.length] = "<a:font script=\"Laoo\" typeface=\"DokChampa\"/>", n[n.length] = "<a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/>", n[n.length] = "<a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/>", n[n.length] = "<a:font script=\"Viet\" typeface=\"Times New Roman\"/>", n[n.length] = "<a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/>", n[n.length] = "<a:font script=\"Geor\" typeface=\"Sylfaen\"/>", n[n.length] = "</a:majorFont>", n[n.length] = "<a:minorFont>", n[n.length] = "<a:latin typeface=\"Calibri\"/>", n[n.length] = "<a:ea typeface=\"\"/>", n[n.length] = "<a:cs typeface=\"\"/>", n[n.length] = "<a:font script=\"Jpan\" typeface=\"ＭＳ Ｐゴシック\"/>", n[n.length] = "<a:font script=\"Hang\" typeface=\"맑은 고딕\"/>", n[n.length] = "<a:font script=\"Hans\" typeface=\"宋体\"/>", n[n.length] = "<a:font script=\"Hant\" typeface=\"新細明體\"/>", n[n.length] = "<a:font script=\"Arab\" typeface=\"Arial\"/>", n[n.length] = "<a:font script=\"Hebr\" typeface=\"Arial\"/>", n[n.length] = "<a:font script=\"Thai\" typeface=\"Tahoma\"/>", n[n.length] = "<a:font script=\"Ethi\" typeface=\"Nyala\"/>", n[n.length] = "<a:font script=\"Beng\" typeface=\"Vrinda\"/>", n[n.length] = "<a:font script=\"Gujr\" typeface=\"Shruti\"/>", n[n.length] = "<a:font script=\"Khmr\" typeface=\"DaunPenh\"/>", n[n.length] = "<a:font script=\"Knda\" typeface=\"Tunga\"/>", n[n.length] = "<a:font script=\"Guru\" typeface=\"Raavi\"/>", n[n.length] = "<a:font script=\"Cans\" typeface=\"Euphemia\"/>", n[n.length] = "<a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/>", n[n.length] = "<a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/>", n[n.length] = "<a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/>", n[n.length] = "<a:font script=\"Thaa\" typeface=\"MV Boli\"/>", n[n.length] = "<a:font script=\"Deva\" typeface=\"Mangal\"/>", n[n.length] = "<a:font script=\"Telu\" typeface=\"Gautami\"/>", n[n.length] = "<a:font script=\"Taml\" typeface=\"Latha\"/>", n[n.length] = "<a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/>", n[n.length] = "<a:font script=\"Orya\" typeface=\"Kalinga\"/>", n[n.length] = "<a:font script=\"Mlym\" typeface=\"Kartika\"/>", n[n.length] = "<a:font script=\"Laoo\" typeface=\"DokChampa\"/>", n[n.length] = "<a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/>", n[n.length] = "<a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/>", n[n.length] = "<a:font script=\"Viet\" typeface=\"Arial\"/>", n[n.length] = "<a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/>", n[n.length] = "<a:font script=\"Geor\" typeface=\"Sylfaen\"/>", n[n.length] = "</a:minorFont>", n[n.length] = "</a:fontScheme>", n[n.length] = "<a:fmtScheme name=\"Office\">", n[n.length] = "<a:fillStyleLst>", n[n.length] = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>", n[n.length] = "<a:gradFill rotWithShape=\"1\">", n[n.length] = "<a:gsLst>", n[n.length] = "<a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"50000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs>", n[n.length] = "<a:gs pos=\"35000\"><a:schemeClr val=\"phClr\"><a:tint val=\"37000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs>", n[n.length] = "<a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:tint val=\"15000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs>", n[n.length] = "</a:gsLst>", n[n.length] = "<a:lin ang=\"16200000\" scaled=\"1\"/>", n[n.length] = "</a:gradFill>", n[n.length] = "<a:gradFill rotWithShape=\"1\">", n[n.length] = "<a:gsLst>", n[n.length] = "<a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"100000\"/><a:shade val=\"100000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs>", n[n.length] = "<a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:tint val=\"50000\"/><a:shade val=\"100000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs>", n[n.length] = "</a:gsLst>", n[n.length] = "<a:lin ang=\"16200000\" scaled=\"0\"/>", n[n.length] = "</a:gradFill>", n[n.length] = "</a:fillStyleLst>", n[n.length] = "<a:lnStyleLst>", n[n.length] = "<a:ln w=\"9525\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"><a:shade val=\"95000\"/><a:satMod val=\"105000\"/></a:schemeClr></a:solidFill><a:prstDash val=\"solid\"/></a:ln>", n[n.length] = "<a:ln w=\"25400\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln>", n[n.length] = "<a:ln w=\"38100\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln>", n[n.length] = "</a:lnStyleLst>", n[n.length] = "<a:effectStyleLst>", n[n.length] = "<a:effectStyle>", n[n.length] = "<a:effectLst>", n[n.length] = "<a:outerShdw blurRad=\"40000\" dist=\"20000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"38000\"/></a:srgbClr></a:outerShdw>", n[n.length] = "</a:effectLst>", n[n.length] = "</a:effectStyle>", n[n.length] = "<a:effectStyle>", n[n.length] = "<a:effectLst>", n[n.length] = "<a:outerShdw blurRad=\"40000\" dist=\"23000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"35000\"/></a:srgbClr></a:outerShdw>", n[n.length] = "</a:effectLst>", n[n.length] = "</a:effectStyle>", n[n.length] = "<a:effectStyle>", n[n.length] = "<a:effectLst>", n[n.length] = "<a:outerShdw blurRad=\"40000\" dist=\"23000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"35000\"/></a:srgbClr></a:outerShdw>", n[n.length] = "</a:effectLst>", n[n.length] = "<a:scene3d><a:camera prst=\"orthographicFront\"><a:rot lat=\"0\" lon=\"0\" rev=\"0\"/></a:camera><a:lightRig rig=\"threePt\" dir=\"t\"><a:rot lat=\"0\" lon=\"0\" rev=\"1200000\"/></a:lightRig></a:scene3d>", n[n.length] = "<a:sp3d><a:bevelT w=\"63500\" h=\"25400\"/></a:sp3d>", n[n.length] = "</a:effectStyle>", n[n.length] = "</a:effectStyleLst>", n[n.length] = "<a:bgFillStyleLst>", n[n.length] = "<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>", n[n.length] = "<a:gradFill rotWithShape=\"1\">", n[n.length] = "<a:gsLst>", n[n.length] = "<a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"40000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs>", n[n.length] = "<a:gs pos=\"40000\"><a:schemeClr val=\"phClr\"><a:tint val=\"45000\"/><a:shade val=\"99000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs>", n[n.length] = "<a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"20000\"/><a:satMod val=\"255000\"/></a:schemeClr></a:gs>", n[n.length] = "</a:gsLst>", n[n.length] = "<a:path path=\"circle\"><a:fillToRect l=\"50000\" t=\"-80000\" r=\"50000\" b=\"180000\"/></a:path>", n[n.length] = "</a:gradFill>", n[n.length] = "<a:gradFill rotWithShape=\"1\">", n[n.length] = "<a:gsLst>", n[n.length] = "<a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"80000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs>", n[n.length] = "<a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"30000\"/><a:satMod val=\"200000\"/></a:schemeClr></a:gs>", n[n.length] = "</a:gsLst>", n[n.length] = "<a:path path=\"circle\"><a:fillToRect l=\"50000\" t=\"50000\" r=\"50000\" b=\"50000\"/></a:path>", n[n.length] = "</a:gradFill>", n[n.length] = "</a:bgFillStyleLst>", n[n.length] = "</a:fmtScheme>", n[n.length] = "</a:themeElements>", n[n.length] = "<a:objectDefaults>", n[n.length] = "<a:spDef>", n[n.length] = "<a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx=\"1\"><a:schemeClr val=\"accent1\"/></a:lnRef><a:fillRef idx=\"3\"><a:schemeClr val=\"accent1\"/></a:fillRef><a:effectRef idx=\"2\"><a:schemeClr val=\"accent1\"/></a:effectRef><a:fontRef idx=\"minor\"><a:schemeClr val=\"lt1\"/></a:fontRef></a:style>", n[n.length] = "</a:spDef>", n[n.length] = "<a:lnDef>", n[n.length] = "<a:spPr/><a:bodyPr/><a:lstStyle/><a:style><a:lnRef idx=\"2\"><a:schemeClr val=\"accent1\"/></a:lnRef><a:fillRef idx=\"0\"><a:schemeClr val=\"accent1\"/></a:fillRef><a:effectRef idx=\"1\"><a:schemeClr val=\"accent1\"/></a:effectRef><a:fontRef idx=\"minor\"><a:schemeClr val=\"tx1\"/></a:fontRef></a:style>", n[n.length] = "</a:lnDef>", n[n.length] = "</a:objectDefaults>", n[n.length] = "<a:extraClrSchemeLst/>", n[n.length] = "</a:theme>", n.join("");
}
function ul(e, t, n) {
	var r = e.l + t;
	if (e.read_shift(4) !== 124226) {
		if (!n.cellStyles) {
			e.l = r;
			return;
		}
		var i = e.slice(e.l);
		e.l = r;
		var a;
		try {
			a = Yt(i, { type: "array" });
		} catch {
			return;
		}
		var o = Gt(a, "theme/theme/theme1.xml", !0);
		if (o) return cl(o, n);
	}
}
function dl(e) {
	return e.read_shift(4);
}
function fl(e) {
	var t = {};
	switch (t.xclrType = e.read_shift(2), t.nTintShade = e.read_shift(2, "i"), t.xclrType) {
		case 0:
			e.l += 4;
			break;
		case 1:
			t.xclrValue = pl(e, 4);
			break;
		case 2:
			t.xclrValue = Ea(e, 4);
			break;
		case 3:
			t.xclrValue = dl(e, 4);
			break;
		case 4:
			e.l += 4;
			break;
	}
	return e.l += 8, t;
}
function pl(e, t) {
	var n = e.l + t, r = e.read_shift(2) & 127;
	return e.l = n, r;
}
function ml(e, t) {
	return mr(e, t);
}
function hl(e) {
	var t = e.read_shift(2), n = e.read_shift(2) - 4, r = [t];
	switch (t) {
		case 4:
		case 5:
		case 7:
		case 8:
		case 9:
		case 10:
		case 11:
		case 13:
			r[1] = fl(e, n);
			break;
		case 6:
			r[1] = ml(e, n);
			break;
		case 14:
		case 15:
			r[1] = e.read_shift(n === 1 ? 1 : 2);
			break;
		default: throw Error("Unrecognized ExtProp type: " + t + " " + n);
	}
	return r;
}
function gl(e, t) {
	var n = e.l + t;
	e.l += 2;
	var r = e.read_shift(2);
	e.l += 2;
	for (var i = e.read_shift(2), a = []; i-- > 0;) a.push(hl(e, n - e.l));
	return {
		ixfe: r,
		ext: a
	};
}
function _l(e, t) {
	e && (e.data || (e.data = {}), t.forEach(function(t) {
		switch (t[0]) {
			case 4:
				e.data.xfextFore = t[1];
				break;
			case 5:
				e.data.xfextBack = t[1];
				break;
			case 6:
				e.data.gradientFill = t[1];
				break;
			case 7:
				e.data.xfextTop = t[1];
				break;
			case 8:
				e.data.xfextBottom = t[1];
				break;
			case 9:
				e.data.xfextLeft = t[1];
				break;
			case 10:
				e.data.xfextRight = t[1];
				break;
			case 11:
				e.data.xfextDiag = t[1];
				break;
			case 13:
				e.xfextFont = t[1];
				break;
			case 14:
				e.fontScheme = t[1];
				break;
			case 15:
				e.data.cIndent = t[1];
				break;
		}
	}));
}
function vl(e, t) {
	return {
		flags: e.read_shift(4),
		version: e.read_shift(4),
		name: Hr(e, t - 8)
	};
}
function yl(e) {
	for (var t = [], n = e.read_shift(4); n-- > 0;) t.push([e.read_shift(4), e.read_shift(4)]);
	return t;
}
function bl(e) {
	return e.l += 4, e.read_shift(4) != 0;
}
function xl(e, t, n) {
	var r = {
		Types: [],
		Cell: [],
		Value: []
	}, i = n || {}, a = [], o = !1, s = 2;
	return gr(e, function(e, t, n) {
		switch (n) {
			case 58: break;
			case 59: break;
			case 335:
				r.Types.push({ name: e.name });
				break;
			case 51:
				e.forEach(function(e) {
					s == 1 ? r.Cell.push({
						type: r.Types[e[0] - 1].name,
						index: e[1]
					}) : s == 0 && r.Value.push({
						type: r.Types[e[0] - 1].name,
						index: e[1]
					});
				});
				break;
			case 337:
				s = +!!e;
				break;
			case 338:
				s = 2;
				break;
			case 35:
				a.push(n), o = !0;
				break;
			case 36:
				a.pop(), o = !1;
				break;
			default: if (!t.T && (!o || i.WTF && a[a.length - 1] != 35)) throw Error("Unexpected record 0x" + n.toString(16));
		}
	}), r;
}
function Sl(e, t, n) {
	var r = {
		Types: [],
		Cell: [],
		Value: []
	};
	if (!e) return r;
	var i = !1, a = 2, o;
	return e.replace(en, function(e) {
		var t = K(e);
		switch (an(t[0])) {
			case "<?xml": break;
			case "<metadata":
			case "</metadata>": break;
			case "<metadataTypes":
			case "</metadataTypes>": break;
			case "<metadataType":
				r.Types.push({ name: t.name });
				break;
			case "</metadataType>": break;
			case "<futureMetadata":
				for (var s = 0; s < r.Types.length; ++s) r.Types[s].name == t.name && (o = r.Types[s]);
				break;
			case "</futureMetadata>": break;
			case "<bk>": break;
			case "</bk>": break;
			case "<rc":
				a == 1 ? r.Cell.push({
					type: r.Types[t.t - 1].name,
					index: +t.v
				}) : a == 0 && r.Value.push({
					type: r.Types[t.t - 1].name,
					index: +t.v
				});
				break;
			case "</rc>": break;
			case "<cellMetadata":
				a = 1;
				break;
			case "</cellMetadata>":
				a = 2;
				break;
			case "<valueMetadata":
				a = 0;
				break;
			case "</valueMetadata>":
				a = 2;
				break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>":
			case "<extLst/>": break;
			case "<ext":
				i = !0;
				break;
			case "</ext>":
				i = !1;
				break;
			case "<rvb":
				if (!o) break;
				o.offsets || (o.offsets = []), o.offsets.push(+t.i);
				break;
			default: if (!i && n != null && n.WTF) throw Error("unrecognized " + t[0] + " in metadata");
		}
		return e;
	}), r;
}
function Cl(e) {
	var t = [];
	if (!e) return t;
	var n = 1;
	return (e.match(en) || []).forEach(function(e) {
		var r = K(e);
		switch (r[0]) {
			case "<?xml": break;
			case "<calcChain":
			case "<calcChain>":
			case "</calcChain>": break;
			case "<c":
				delete r[0], r.i ? n = r.i : r.i = n, t.push(r);
				break;
		}
	}), t;
}
function wl(e) {
	var t = {};
	t.i = e.read_shift(4);
	var n = {};
	n.r = e.read_shift(4), n.c = e.read_shift(4), t.r = Y(n);
	var r = e.read_shift(1);
	return r & 2 && (t.l = "1"), r & 8 && (t.a = "1"), t;
}
function Tl(e, t, n) {
	var r = [], i = !1;
	return gr(e, function(e, t, a) {
		switch (a) {
			case 63:
				r.push(e);
				break;
			default: if (!t.T && (!i || n.WTF)) throw Error("Unexpected record 0x" + a.toString(16));
		}
	}), r;
}
function El(e, t, n, r) {
	if (!e) return e;
	var i = r || {}, a = !1, o = !1;
	gr(e, function(e, t, n) {
		if (!o) switch (n) {
			case 359:
			case 363:
			case 364:
			case 366:
			case 367:
			case 368:
			case 369:
			case 370:
			case 371:
			case 472:
			case 577:
			case 578:
			case 579:
			case 580:
			case 581:
			case 582:
			case 583:
			case 584:
			case 585:
			case 586:
			case 587:
			case 5108: break;
			case 35:
				a = !0;
				break;
			case 36:
				a = !1;
				break;
			default: if (!t.T && (!a || i.WTF)) throw Error("Unexpected record 0x" + n.toString(16));
		}
	}, i);
}
function Dl(e, t) {
	if (!e) return {
		charts: [],
		images: [],
		shapes: [],
		raw: ""
	};
	var n = {
		charts: [],
		images: [],
		shapes: [],
		raw: e
	};
	return t || (t = { "!id": {} }), (e.match(/<(?:\w+:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1>/g) || [e]).forEach(function(e) {
		var r = kl(e);
		(e.match(/<c:chart\b[^<>]*r:id="([^<>"]*)"/g) || []).forEach(function(e) {
			var i = e.match(/r:id="([^<>"]*)"/);
			if (i) {
				var a = t["!id"][i[1]] || {};
				n.charts.push({
					id: i[1],
					rel: a,
					target: a.Target,
					anchor: r
				});
			}
		}), (e.match(/<a:blip\b[^<>]*(?:r:embed|r:link)="([^<>"]*)"/g) || []).forEach(function(e) {
			var i = e.match(/(?:r:embed|r:link)="([^<>"]*)"/);
			if (i) {
				var a = t["!id"][i[1]] || {};
				n.images.push({
					id: i[1],
					rel: a,
					target: a.Target,
					anchor: r
				});
			}
		});
		var i = Al(e);
		i && n.shapes.push({
			text: i,
			anchor: r,
			raw: e
		});
	}), n.chart = n.charts[0] && n.charts[0].target, n;
}
function Ol(e, t) {
	var n = Ft(e, t), r = n && n[1] || "";
	function i(e) {
		var t = Ft(r, e);
		return t && t[1] != null ? parseInt(t[1], 10) : 0;
	}
	return {
		col: i("col"),
		colOff: i("colOff"),
		row: i("row"),
		rowOff: i("rowOff")
	};
}
function kl(e) {
	var t = { type: (e.match(/^<(?:\w+:)?(\w+)/) || [])[1] || "anchor" };
	(e.indexOf("<xdr:from") >= 0 || e.indexOf("<from") >= 0) && (t.from = Ol(e, "from")), (e.indexOf("<xdr:to") >= 0 || e.indexOf("<to") >= 0) && (t.to = Ol(e, "to"));
	var n = e.match(/<(?:\w+:)?pos\b[^<>]*\/>/);
	if (n) {
		var r = K(n[0]);
		t.pos = {
			x: r.x ? parseInt(r.x, 10) : 0,
			y: r.y ? parseInt(r.y, 10) : 0
		};
	}
	var i = e.match(/<(?:\w+:)?ext\b[^<>]*\/>/);
	if (i) {
		var a = K(i[0]);
		t.ext = {
			cx: a.cx ? parseInt(a.cx, 10) : 0,
			cy: a.cy ? parseInt(a.cy, 10) : 0
		};
	}
	return t;
}
function Al(e) {
	var t = [];
	return (e.match(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g) || []).forEach(function(e) {
		t.push(q(e.replace(/<[^>]*>/g, "")));
	}), t.join("");
}
function jl(e, t, n) {
	var r = e.slice(e.l, e.l + t);
	return e.l += t, !n || !n.drawings && !n.charts ? {
		raw: r,
		blips: [],
		shapes: [],
		images: [],
		charts: [],
		groups: !0
	} : Fl(r, !0);
}
function Ml(e, t, n) {
	var r = e.slice(e.l, e.l + t);
	return e.l += t, !n || !n.drawings && !n.charts ? {
		raw: r,
		blips: [],
		shapes: [],
		images: [],
		charts: [],
		groups: !1
	} : Fl(r, !1);
}
function Nl(e, t) {
	return e[t] | e[t + 1] << 8;
}
function Pl(e, t) {
	return (e[t] | e[t + 1] << 8 | e[t + 2] << 16 | e[t + 3] << 24) >>> 0;
}
function Fl(e, t) {
	var n = {
		raw: e,
		blips: [],
		shapes: [],
		images: [],
		charts: [],
		groups: !!t
	}, r = {
		out: n,
		current: null
	};
	try {
		Il(e, 0, e.length, r);
	} catch (e) {
		n.error = e.message || String(e);
	}
	return n;
}
function Il(e, t, n, r) {
	for (var i = t; i + 8 <= n && i + 8 <= e.length;) {
		var a = Nl(e, i), o = Nl(e, i + 2), s = Pl(e, i + 4), c = a & 15, l = a >> 4, u = i + 8, d = u + s;
		if (d > e.length && (d = e.length), o == 61444) {
			var f = {
				raw: e.slice(i, d),
				props: {}
			};
			r.out.shapes.push(f);
			var p = r.current;
			r.current = f, Il(e, u, d, r), r.current = p;
		} else o == 61447 ? r.out.blips.push(Bl(e, u, d, l)) : o == 61450 && r.current ? (r.current.spid = Pl(e, u), r.current.flags = Pl(e, u + 4)) : o == 61451 && r.current ? (r.current.props = Ll(e, u, d, l), r.current.props.pib != null && (r.current.blipId = r.current.props.pib)) : o == 61456 && r.current ? r.current.anchor = Rl(e, u, d) : o == 61457 && r.current ? r.current.clientData = e.slice(u, d) : c == 15 && Il(e, u, d, r);
		i = d;
	}
}
function Ll(e, t, n, r) {
	for (var i = {}, a = [], o = t, s = 0; s < r && o + 6 <= n; ++s, o += 6) {
		var c = Nl(e, o), l = Pl(e, o + 2), u = c & 16383;
		i[u] = l, c & 16384 && a.push([u, l]), u == 260 && (i.pib = l), u == 261 && (i.pibName = l), u == 896 && (i.fillColor = l), u == 897 && (i.fillOpacity = l), u == 959 && (i.lineColor = l);
	}
	return a.forEach(function(t) {
		o + t[1] <= n && (i["complex_" + t[0]] = e.slice(o, o + t[1])), o += t[1];
	}), i;
}
function Rl(e, t, n) {
	if (n - t < 18) return {};
	var r = t, i = Nl(e, r);
	r += 2;
	var a = Nl(e, r), o = Nl(e, r + 2), s = Nl(e, r + 4), c = Nl(e, r + 6);
	r += 8;
	var l = Nl(e, r), u = Nl(e, r + 2), d = Nl(e, r + 4), f = Nl(e, r + 6);
	return {
		type: "twoCellAnchor",
		flags: i,
		from: {
			col: a,
			colOff: o * 9525 / 1024,
			row: s,
			rowOff: c * 9525 / 256
		},
		to: {
			col: l,
			colOff: u * 9525 / 1024,
			row: d,
			rowOff: f * 9525 / 256
		}
	};
}
function zl(e, t, n) {
	for (var r = t; r + 8 <= n; ++r) {
		if (e[r] == 137 && e[r + 1] == 80 && e[r + 2] == 78 && e[r + 3] == 71) return [r, "image/png"];
		if (e[r] == 255 && e[r + 1] == 216 && e[r + 2] == 255) return [r, "image/jpeg"];
		if (e[r] == 66 && e[r + 1] == 77) return [r, "image/bmp"];
	}
	return [t, ""];
}
function Bl(e, t, n, r) {
	var i = {
		index: r,
		raw: e.slice(t, n)
	};
	if (n - t < 36) return i;
	i.btWin32 = e[t], i.btMacOS = e[t + 1], i.size = Pl(e, t + 20), i.cRef = Pl(e, t + 24);
	var a = t + 36;
	if (a + 8 <= n) {
		i.blipType = Nl(e, a + 2);
		var o = a + 8, s = n, c = zl(e, o, s);
		c[1] && (i.contentType = c[1], i.data = e.slice(c[0], s), i.dataURI = "data:" + i.contentType + ";base64," + x(i.data));
	}
	return i;
}
function Vl(e, t, n) {
	var r = 0;
	(It(e, "(?:shape|rect)") || []).forEach(function(e) {
		var i = "", a = !0, o = -1, s = -1, c = -1;
		switch (e.replace(en, function(t, n) {
			var r = K(t);
			switch (an(r[0])) {
				case "<ClientData":
					r.ObjectType && (i = r.ObjectType);
					break;
				case "<Visible":
				case "<Visible/>":
					a = !1;
					break;
				case "<Row":
				case "<Row>":
					o = n + t.length;
					break;
				case "</Row>":
					s = +e.slice(o, n).trim();
					break;
				case "<Column":
				case "<Column>":
					o = n + t.length;
					break;
				case "</Column>":
					c = +e.slice(o, n).trim();
					break;
			}
			return "";
		}), i) {
			case "Note":
				var l = _g(t, s >= 0 && c >= 0 ? Y({
					r: s,
					c
				}) : n[r].ref);
				l.c && (l.c.hidden = a), ++r;
				break;
		}
	});
}
function Hl(e, t, n, r) {
	var i = e["!data"] != null, a;
	t.forEach(function(t) {
		var o = jr(t.ref);
		if (!(o.r < 0 || o.c < 0)) {
			if (i ? (e["!data"][o.r] || (e["!data"][o.r] = []), a = e["!data"][o.r][o.c]) : a = e[t.ref], !a) {
				a = { t: "z" }, i ? e["!data"][o.r][o.c] = a : e[t.ref] = a;
				var s = Pr(e["!ref"] || "BDWGO1000001:A1");
				s.s.r > o.r && (s.s.r = o.r), s.e.r < o.r && (s.e.r = o.r), s.s.c > o.c && (s.s.c = o.c), s.e.c < o.c && (s.e.c = o.c), e["!ref"] = X(s);
			}
			a.c || (a.c = []);
			var c = {
				a: t.author,
				t: t.t,
				r: t.r,
				T: n
			};
			t.h && (c.h = t.h);
			for (var l = a.c.length - 1; l >= 0; --l) {
				if (!n && a.c[l].T) return;
				n && !a.c[l].T && a.c.splice(l, 1);
			}
			if (n && r) {
				for (l = 0; l < r.length; ++l) if (c.a == r[l].id) {
					c.a = r[l].name || c.a;
					break;
				}
			}
			a.c.push(c);
		}
	});
}
function Ul(e, t) {
	if (e.match(/<(?:\w+:)?comments *\/>/)) return [];
	var n = [], r = [], i = Ft(e, "authors");
	i && i[1] && i[1].split(/<\/\w*:?author>/).forEach(function(e) {
		if (!(e === "" || e.trim() === "")) {
			var t = e.match(/<(?:\w+:)?author[^<>]*>(.*)/);
			t && n.push(t[1]);
		}
	});
	var a = Ft(e, "commentList");
	return a && a[1] && a[1].split(/<\/\w*:?comment>/).forEach(function(e) {
		if (!(e === "" || e.trim() === "")) {
			var i = e.match(/<(?:\w+:)?comment[^<>]*>/);
			if (i) {
				var a = K(i[0]), o = {
					author: a.authorId && n[a.authorId] || "sheetjsghost",
					ref: a.ref,
					guid: a.guid
				}, s = jr(a.ref);
				if (!(t.sheetRows && t.sheetRows <= s.r)) {
					var c = Ft(e, "text"), l = !!c && !!c[1] && ys(c[1]) || {
						r: "",
						t: "",
						h: ""
					};
					o.r = l.r, l.r == "<t></t>" && (l.t = l.h = ""), o.t = (l.t || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), t.cellHTML && (o.h = l.h), r.push(o);
				}
			}
		}
	}), r;
}
function Wl(e, t) {
	var n = [], r = !1, i = {}, a = 0;
	return e.replace(en, function(o, s) {
		var c = K(o);
		switch (an(c[0])) {
			case "<?xml": break;
			case "<ThreadedComments": break;
			case "</ThreadedComments>": break;
			case "<threadedComment":
				i = {
					author: c.personId,
					guid: c.id,
					ref: c.ref,
					T: 1
				};
				break;
			case "</threadedComment>":
				i.t != null && n.push(i);
				break;
			case "<text>":
			case "<text":
				a = s + o.length;
				break;
			case "</text>":
				i.t = e.slice(a, s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
				break;
			case "<mentions":
			case "<mentions>":
				r = !0;
				break;
			case "</mentions>":
				r = !1;
				break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>":
			case "<extLst/>": break;
			case "<ext":
				r = !0;
				break;
			case "</ext>":
				r = !1;
				break;
			default: if (!r && t.WTF) throw Error("unrecognized " + c[0] + " in threaded comments");
		}
		return o;
	}), n;
}
function Gl(e, t) {
	var n = [], r = !1;
	return e.replace(en, function(e) {
		var i = K(e);
		switch (an(i[0])) {
			case "<?xml": break;
			case "<personList": break;
			case "</personList>": break;
			case "<person":
				n.push({
					name: i.displayname,
					id: i.id
				});
				break;
			case "</person>": break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>":
			case "<extLst/>": break;
			case "<ext":
				r = !0;
				break;
			case "</ext>":
				r = !1;
				break;
			default: if (!r && t.WTF) throw Error("unrecognized " + i[0] + " in threaded comments");
		}
		return e;
	}), n;
}
function Kl(e) {
	var t = {};
	t.iauthor = e.read_shift(4);
	var n = ei(e, 16);
	return t.rfx = n.s, t.ref = Y(n.s), e.l += 16, t;
}
var ql = Hr;
function Jl(e, t) {
	var n = [], r = [], i = {}, a = !1;
	return gr(e, function(e, o, s) {
		switch (s) {
			case 632:
				r.push(e);
				break;
			case 635:
				i = e;
				break;
			case 637:
				i.t = e.t, i.h = e.h, i.r = e.r;
				break;
			case 636:
				if (i.author = r[i.iauthor], delete i.iauthor, t.sheetRows && i.rfx && t.sheetRows <= i.rfx.r) break;
				i.t || (i.t = ""), delete i.rfx, n.push(i);
				break;
			case 3072: break;
			case 35:
				a = !0;
				break;
			case 36:
				a = !1;
				break;
			case 37: break;
			case 38: break;
			default: if (!o.T && (!a || t.WTF)) throw Error("Unexpected record 0x" + s.toString(16));
		}
	}), n;
}
var Yl = "application/vnd.ms-office.vbaProject";
function Xl(e) {
	var t = et.utils.cfb_new({ root: "R" });
	return e.FullPaths.forEach(function(n, r) {
		if (!(n.slice(-1) === "/" || !n.match(/_VBA_PROJECT_CUR/))) {
			var i = n.replace(/^[^\/]*/, "R").replace(/\/_VBA_PROJECT_CUR\u0000*/, "");
			et.utils.cfb_add(t, i, e.FileIndex[r].content);
		}
	}), et.write(t);
}
function Zl() {
	return { "!type": "dialog" };
}
function Ql() {
	return { "!type": "dialog" };
}
function $l() {
	return { "!type": "macro" };
}
function eu() {
	return { "!type": "macro" };
}
var tu = /*#__PURE__*/ (function() {
	var e = /(^|[^A-Za-z_])R(\[?-?\d+\]|[1-9]\d*|)C(\[?-?\d+\]|[1-9]\d*|)(?![A-Za-z0-9_])/g, t = {
		r: 0,
		c: 0
	};
	function n(e, n, r, i) {
		var a = !1, o = !1;
		r.length == 0 ? o = !0 : r.charAt(0) == "[" && (o = !0, r = r.slice(1, -1)), i.length == 0 ? a = !0 : i.charAt(0) == "[" && (a = !0, i = i.slice(1, -1));
		var s = r.length > 0 ? parseInt(r, 10) | 0 : 0, c = i.length > 0 ? parseInt(i, 10) | 0 : 0;
		return a ? c += t.c : --c, o ? s += t.r : --s, n + (a ? "" : "$") + Dr(c) + (o ? "" : "$") + Cr(s);
	}
	return function(r, i) {
		return t = i, r.replace(e, n);
	};
})(), nu = /(^|[^._A-Za-z0-9])(\$?)([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])(\$?)(\d{1,7})(?![_.\(A-Za-z0-9])/g;
try {
	nu = /(^|[^._A-Za-z0-9])([$]?)([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])([$]?)(10[0-3]\d{4}|104[0-7]\d{3}|1048[0-4]\d{2}|10485[0-6]\d|104857[0-6]|[1-9]\d{0,5})(?![_.\(A-Za-z0-9])/g;
} catch {}
var ru = /*#__PURE__*/ (function() {
	return function(e, t) {
		return e.replace(nu, function(e, n, r, i, a, o) {
			var s = Er(i) - (r ? 0 : t.c), c = Sr(o) - (a ? 0 : t.r), l = a == "$" ? c + 1 : c == 0 ? "" : "[" + c + "]", u = r == "$" ? s + 1 : s == 0 ? "" : "[" + s + "]";
			return n + "R" + l + "C" + u;
		});
	};
})();
function iu(e, t) {
	return e.replace(nu, function(e, n, r, i, a, o) {
		return n + (r == "$" ? r + i : Dr(Er(i) + t.c)) + (a == "$" ? a + o : Cr(Sr(o) + t.r));
	});
}
function au(e, t, n) {
	var r = Mr(t).s, i = jr(n);
	return iu(e, {
		r: i.r - r.r,
		c: i.c - r.c
	});
}
function ou(e) {
	return e.length != 1;
}
function su(e) {
	return e.replace(/_xlfn\./g, "");
}
function cu(e) {
	e.l += 1;
}
function lu(e, t) {
	var n = e.read_shift(t == 1 ? 1 : 2);
	return [
		n & 16383,
		n >> 14 & 1,
		n >> 15 & 1
	];
}
function uu(e, t, n) {
	var r = 2;
	if (n) {
		if (n.biff >= 2 && n.biff <= 5) return du(e, t, n);
		n.biff == 12 && (r = 4);
	}
	var i = e.read_shift(r), a = e.read_shift(r), o = lu(e, 2), s = lu(e, 2);
	return {
		s: {
			r: i,
			c: o[0],
			cRel: o[1],
			rRel: o[2]
		},
		e: {
			r: a,
			c: s[0],
			cRel: s[1],
			rRel: s[2]
		}
	};
}
function du(e) {
	var t = lu(e, 2), n = lu(e, 2), r = e.read_shift(1), i = e.read_shift(1);
	return {
		s: {
			r: t[0],
			c: r,
			cRel: t[1],
			rRel: t[2]
		},
		e: {
			r: n[0],
			c: i,
			cRel: n[1],
			rRel: n[2]
		}
	};
}
function fu(e, t, n) {
	if (n.biff < 8) return du(e, t, n);
	var r = e.read_shift(n.biff == 12 ? 4 : 2), i = e.read_shift(n.biff == 12 ? 4 : 2), a = lu(e, 2), o = lu(e, 2);
	return {
		s: {
			r,
			c: a[0],
			cRel: a[1],
			rRel: a[2]
		},
		e: {
			r: i,
			c: o[0],
			cRel: o[1],
			rRel: o[2]
		}
	};
}
function pu(e, t, n) {
	if (n && n.biff >= 2 && n.biff <= 5) return mu(e, t, n);
	var r = e.read_shift(n && n.biff == 12 ? 4 : 2), i = lu(e, 2);
	return {
		r,
		c: i[0],
		cRel: i[1],
		rRel: i[2]
	};
}
function mu(e) {
	var t = lu(e, 2), n = e.read_shift(1);
	return {
		r: t[0],
		c: n,
		cRel: t[1],
		rRel: t[2]
	};
}
function hu(e) {
	var t = e.read_shift(2), n = e.read_shift(2);
	return {
		r: t,
		c: n & 255,
		fQuoted: !!(n & 16384),
		cRel: n >> 15,
		rRel: n >> 15
	};
}
function gu(e, t, n) {
	var r = n && n.biff ? n.biff : 8;
	if (r >= 2 && r <= 5) return _u(e, t, n);
	var i = e.read_shift(r >= 12 ? 4 : 2), a = e.read_shift(2), o = (a & 16384) >> 14, s = (a & 32768) >> 15;
	if (a &= 16383, s == 1) for (; i > 524287;) i -= 1048576;
	if (o == 1) for (; a > 8191;) a -= 16384;
	return {
		r: i,
		c: a,
		cRel: o,
		rRel: s
	};
}
function _u(e) {
	var t = e.read_shift(2), n = e.read_shift(1), r = (t & 32768) >> 15, i = (t & 16384) >> 14;
	return t &= 16383, r == 1 && t >= 8192 && (t -= 16384), i == 1 && n >= 128 && (n -= 256), {
		r: t,
		c: n,
		cRel: i,
		rRel: r
	};
}
function vu(e, t, n) {
	return [(e[e.l++] & 96) >> 5, uu(e, n.biff >= 2 && n.biff <= 5 ? 6 : 8, n)];
}
function yu(e, t, n) {
	var r = (e[e.l++] & 96) >> 5, i = e.read_shift(2, "i"), a = 8;
	if (n) switch (n.biff) {
		case 5:
			e.l += 12, a = 6;
			break;
		case 12:
			a = 12;
			break;
	}
	return [
		r,
		i,
		uu(e, a, n)
	];
}
function bu(e, t, n) {
	var r = (e[e.l++] & 96) >> 5;
	return e.l += n && n.biff > 8 ? 12 : n.biff < 8 ? 6 : 8, [r];
}
function xu(e, t, n) {
	var r = (e[e.l++] & 96) >> 5, i = e.read_shift(2), a = 8;
	if (n) switch (n.biff) {
		case 5:
			e.l += 12, a = 6;
			break;
		case 12:
			a = 12;
			break;
	}
	return e.l += a, [r, i];
}
function Su(e, t, n) {
	return [(e[e.l++] & 96) >> 5, fu(e, t - 1, n)];
}
function Cu(e, t, n) {
	var r = (e[e.l++] & 96) >> 5;
	return e.l += n.biff == 2 ? 6 : n.biff == 12 ? 14 : 7, [r];
}
function wu(e) {
	var t = e[e.l + 1] & 1;
	return e.l += 4, [t, 1];
}
function Tu(e, t, n) {
	e.l += 2;
	for (var r = e.read_shift(n && n.biff == 2 ? 1 : 2), i = [], a = 0; a <= r; ++a) i.push(e.read_shift(n && n.biff == 2 ? 1 : 2));
	return i;
}
function Eu(e, t, n) {
	var r = e[e.l + 1] & 255 ? 1 : 0;
	return e.l += 2, [r, e.read_shift(n && n.biff == 2 ? 1 : 2)];
}
function Du(e, t, n) {
	var r = e[e.l + 1] & 255 ? 1 : 0;
	return e.l += 2, [r, e.read_shift(n && n.biff == 2 ? 1 : 2)];
}
function Ou(e) {
	var t = e[e.l + 1] & 255 ? 1 : 0;
	return e.l += 2, [t, e.read_shift(2)];
}
function ku(e, t, n) {
	var r = e[e.l + 1] & 255 ? 1 : 0;
	return e.l += n && n.biff == 2 ? 3 : 4, [r];
}
function Au(e) {
	return [e.read_shift(1), e.read_shift(1)];
}
function ju(e) {
	return e.read_shift(2), Au(e, 2);
}
function Mu(e) {
	return e.read_shift(2), Au(e, 2);
}
function Nu(e, t, n) {
	var r = (e[e.l] & 96) >> 5;
	return e.l += 1, [r, pu(e, 0, n)];
}
function Pu(e, t, n) {
	var r = (e[e.l] & 96) >> 5;
	return e.l += 1, [r, gu(e, 0, n)];
}
function Fu(e, t, n) {
	var r = (e[e.l] & 96) >> 5;
	e.l += 1;
	var i = e.read_shift(2);
	return n && n.biff == 5 && (e.l += 12), [
		r,
		i,
		pu(e, 0, n)
	];
}
function Iu(e, t, n) {
	var r = (e[e.l] & 96) >> 5;
	e.l += 1;
	var i = e.read_shift(n && n.biff <= 3 ? 1 : 2);
	return [
		Xd[i],
		Yd[i],
		r
	];
}
function Lu(e, t, n) {
	var r = e[e.l++], i = e.read_shift(1), a = n && n.biff <= 3 ? [r == 88 ? -1 : 0, e.read_shift(1)] : Ru(e);
	return [i, (a[0] === 0 ? Yd : Jd)[a[1]]];
}
function Ru(e) {
	return [e[e.l + 1] >> 7, e.read_shift(2) & 32767];
}
function zu(e, t, n) {
	e.l += n && n.biff == 2 ? 3 : 4;
}
function Bu(e, t, n) {
	return e.l++, n && n.biff == 12 ? [e.read_shift(4, "i"), 0] : [e.read_shift(2), e.read_shift(n && n.biff == 2 ? 1 : 2)];
}
function Vu(e) {
	return e.l++, Ei[e.read_shift(1)];
}
function Hu(e) {
	return e.l++, e.read_shift(2);
}
function Uu(e) {
	return e.l++, e.read_shift(1) !== 0;
}
function Wu(e) {
	return e.l++, ti(e, 8);
}
function Gu(e, t, n) {
	return e.l++, ha(e, t - 1, n);
}
function Ku(e, t) {
	var n = [e.read_shift(1)];
	if (t == 12) switch (n[0]) {
		case 2:
			n[0] = 4;
			break;
		case 4:
			n[0] = 16;
			break;
		case 0:
			n[0] = 1;
			break;
		case 1:
			n[0] = 2;
			break;
	}
	switch (n[0]) {
		case 4:
			n[1] = da(e, 1) ? "TRUE" : "FALSE", t != 12 && (e.l += 7);
			break;
		case 37:
		case 16:
			n[1] = Ei[e[e.l]], e.l += t == 12 ? 4 : 8;
			break;
		case 0:
			e.l += 8;
			break;
		case 1:
			n[1] = ti(e, 8);
			break;
		case 2:
			n[1] = ya(e, 0, { biff: t > 0 && t < 8 ? 2 : t });
			break;
		default: throw Error("Bad SerAr: " + n[0]);
	}
	return n;
}
function qu(e, t, n) {
	for (var r = e.read_shift(n.biff == 12 ? 4 : 2), i = [], a = 0; a != r; ++a) i.push((n.biff == 12 ? ei : Pa)(e, 8));
	return i;
}
function Ju(e, t, n) {
	var r = 0, i = 0;
	n.biff == 12 ? (r = e.read_shift(4), i = e.read_shift(4)) : (i = 1 + e.read_shift(1), r = 1 + e.read_shift(2)), n.biff >= 2 && n.biff < 8 && (--r, --i == 0 && (i = 256));
	for (var a = 0, o = []; a != r && (o[a] = []); ++a) for (var s = 0; s != i; ++s) o[a][s] = Ku(e, n.biff);
	return o;
}
function Yu(e, t, n) {
	var r = e.read_shift(1) >>> 5 & 3, i = !n || n.biff >= 8 ? 4 : 2, a = e.read_shift(i);
	switch (n.biff) {
		case 2:
			e.l += 5;
			break;
		case 3:
		case 4:
			e.l += 8;
			break;
		case 5:
			e.l += 12;
			break;
	}
	return [
		r,
		0,
		a
	];
}
function Xu(e, t, n) {
	return n.biff == 5 ? Zu(e, t, n) : [
		e.read_shift(1) >>> 5 & 3,
		e.read_shift(2),
		e.read_shift(4)
	];
}
function Zu(e) {
	var t = e.read_shift(1) >>> 5 & 3, n = e.read_shift(2, "i");
	e.l += 8;
	var r = e.read_shift(2);
	return e.l += 12, [
		t,
		n,
		r
	];
}
function Qu(e, t, n) {
	var r = e.read_shift(1) >>> 5 & 3;
	return e.l += n && n.biff == 2 ? 3 : 4, [r, e.read_shift(n && n.biff == 2 ? 1 : 2)];
}
function $u(e, t, n) {
	return [e.read_shift(1) >>> 5 & 3, e.read_shift(n && n.biff == 2 ? 1 : 2)];
}
function ed(e, t, n) {
	var r = e.read_shift(1) >>> 5 & 3;
	return e.l += 4, n.biff < 8 && e.l--, n.biff == 12 && (e.l += 2), [r];
}
function td(e, t, n) {
	var r = (e[e.l++] & 96) >> 5, i = e.read_shift(2), a = 4;
	if (n) switch (n.biff) {
		case 5:
			a = 15;
			break;
		case 12:
			a = 6;
			break;
	}
	return e.l += a, [r, i];
}
var nd = mr, rd = mr, id = mr;
function ad(e, t, n) {
	return e.l += 2, [hu(e, 4, n)];
}
function od(e) {
	return e.l += 6, [];
}
var sd = ad, cd = od, ld = od, ud = ad;
function dd(e) {
	return e.l += 2, [fa(e), e.read_shift(2) & 1];
}
var fd = ad, pd = dd, md = od, hd = ad, gd = ad, _d = [
	"Data",
	"All",
	"Headers",
	"??",
	"?Data2",
	"??",
	"?DataHeaders",
	"??",
	"Totals",
	"??",
	"??",
	"??",
	"?DataTotals",
	"??",
	"??",
	"??",
	"?Current"
];
function vd(e) {
	e.l += 2;
	var t = e.read_shift(2), n = e.read_shift(2), r = e.read_shift(4), i = e.read_shift(2), a = e.read_shift(2), o = _d[n >> 2 & 31];
	return {
		ixti: t,
		coltype: n & 3,
		rt: o,
		idx: r,
		c: i,
		C: a
	};
}
function yd(e) {
	return e.l += 2, [e.read_shift(4)];
}
function bd(e, t, n) {
	return e.l += 5, e.l += 2, e.l += n.biff == 2 ? 1 : 4, ["PTGSHEET"];
}
function xd(e, t, n) {
	return e.l += n.biff == 2 ? 4 : 5, ["PTGENDSHEET"];
}
function Sd(e) {
	return [e.read_shift(1) >>> 5 & 3, e.read_shift(2)];
}
function Cd(e) {
	return [e.read_shift(1) >>> 5 & 3, e.read_shift(2)];
}
function wd(e) {
	return e.l += 4, [0, 0];
}
var Td = {
	1: {
		n: "PtgExp",
		f: Bu
	},
	2: {
		n: "PtgTbl",
		f: id
	},
	3: {
		n: "PtgAdd",
		f: cu
	},
	4: {
		n: "PtgSub",
		f: cu
	},
	5: {
		n: "PtgMul",
		f: cu
	},
	6: {
		n: "PtgDiv",
		f: cu
	},
	7: {
		n: "PtgPower",
		f: cu
	},
	8: {
		n: "PtgConcat",
		f: cu
	},
	9: {
		n: "PtgLt",
		f: cu
	},
	10: {
		n: "PtgLe",
		f: cu
	},
	11: {
		n: "PtgEq",
		f: cu
	},
	12: {
		n: "PtgGe",
		f: cu
	},
	13: {
		n: "PtgGt",
		f: cu
	},
	14: {
		n: "PtgNe",
		f: cu
	},
	15: {
		n: "PtgIsect",
		f: cu
	},
	16: {
		n: "PtgUnion",
		f: cu
	},
	17: {
		n: "PtgRange",
		f: cu
	},
	18: {
		n: "PtgUplus",
		f: cu
	},
	19: {
		n: "PtgUminus",
		f: cu
	},
	20: {
		n: "PtgPercent",
		f: cu
	},
	21: {
		n: "PtgParen",
		f: cu
	},
	22: {
		n: "PtgMissArg",
		f: cu
	},
	23: {
		n: "PtgStr",
		f: Gu
	},
	26: {
		n: "PtgSheet",
		f: bd
	},
	27: {
		n: "PtgEndSheet",
		f: xd
	},
	28: {
		n: "PtgErr",
		f: Vu
	},
	29: {
		n: "PtgBool",
		f: Uu
	},
	30: {
		n: "PtgInt",
		f: Hu
	},
	31: {
		n: "PtgNum",
		f: Wu
	},
	32: {
		n: "PtgArray",
		f: Cu
	},
	33: {
		n: "PtgFunc",
		f: Iu
	},
	34: {
		n: "PtgFuncVar",
		f: Lu
	},
	35: {
		n: "PtgName",
		f: Yu
	},
	36: {
		n: "PtgRef",
		f: Nu
	},
	37: {
		n: "PtgArea",
		f: vu
	},
	38: {
		n: "PtgMemArea",
		f: Qu
	},
	39: {
		n: "PtgMemErr",
		f: nd
	},
	40: {
		n: "PtgMemNoMem",
		f: rd
	},
	41: {
		n: "PtgMemFunc",
		f: $u
	},
	42: {
		n: "PtgRefErr",
		f: ed
	},
	43: {
		n: "PtgAreaErr",
		f: bu
	},
	44: {
		n: "PtgRefN",
		f: Pu
	},
	45: {
		n: "PtgAreaN",
		f: Su
	},
	46: {
		n: "PtgMemAreaN",
		f: Sd
	},
	47: {
		n: "PtgMemNoMemN",
		f: Cd
	},
	57: {
		n: "PtgNameX",
		f: Xu
	},
	58: {
		n: "PtgRef3d",
		f: Fu
	},
	59: {
		n: "PtgArea3d",
		f: yu
	},
	60: {
		n: "PtgRefErr3d",
		f: td
	},
	61: {
		n: "PtgAreaErr3d",
		f: xu
	},
	255: {}
}, Ed = {
	64: 32,
	96: 32,
	65: 33,
	97: 33,
	66: 34,
	98: 34,
	67: 35,
	99: 35,
	68: 36,
	100: 36,
	69: 37,
	101: 37,
	70: 38,
	102: 38,
	71: 39,
	103: 39,
	72: 40,
	104: 40,
	73: 41,
	105: 41,
	74: 42,
	106: 42,
	75: 43,
	107: 43,
	76: 44,
	108: 44,
	77: 45,
	109: 45,
	78: 46,
	110: 46,
	79: 47,
	111: 47,
	88: 34,
	120: 34,
	89: 57,
	121: 57,
	90: 58,
	122: 58,
	91: 59,
	123: 59,
	92: 60,
	124: 60,
	93: 61,
	125: 61
}, Dd = {
	1: {
		n: "PtgElfLel",
		f: dd
	},
	2: {
		n: "PtgElfRw",
		f: hd
	},
	3: {
		n: "PtgElfCol",
		f: sd
	},
	6: {
		n: "PtgElfRwV",
		f: gd
	},
	7: {
		n: "PtgElfColV",
		f: ud
	},
	10: {
		n: "PtgElfRadical",
		f: fd
	},
	11: {
		n: "PtgElfRadicalS",
		f: md
	},
	13: {
		n: "PtgElfColS",
		f: cd
	},
	15: {
		n: "PtgElfColSV",
		f: ld
	},
	16: {
		n: "PtgElfRadicalLel",
		f: pd
	},
	25: {
		n: "PtgList",
		f: vd
	},
	29: {
		n: "PtgSxName",
		f: yd
	},
	255: {}
}, Od = {
	0: {
		n: "PtgAttrNoop",
		f: wd
	},
	1: {
		n: "PtgAttrSemi",
		f: ku
	},
	2: {
		n: "PtgAttrIf",
		f: Du
	},
	4: {
		n: "PtgAttrChoose",
		f: Tu
	},
	8: {
		n: "PtgAttrGoto",
		f: Eu
	},
	16: {
		n: "PtgAttrSum",
		f: zu
	},
	32: {
		n: "PtgAttrBaxcel",
		f: wu
	},
	33: {
		n: "PtgAttrBaxcel",
		f: wu
	},
	64: {
		n: "PtgAttrSpace",
		f: ju
	},
	65: {
		n: "PtgAttrSpaceSemi",
		f: Mu
	},
	128: {
		n: "PtgAttrIfError",
		f: Ou
	},
	255: {}
};
function kd(e, t, n, r) {
	if (r.biff < 8) return mr(e, t);
	for (var i = e.l + t, a = [], o = 0; o !== n.length; ++o) switch (n[o][0]) {
		case "PtgArray":
			n[o][1] = Ju(e, 0, r), a.push(n[o][1]);
			break;
		case "PtgMemArea":
			n[o][2] = qu(e, n[o][1], r), a.push(n[o][2]);
			break;
		case "PtgExp":
			r && r.biff == 12 && (n[o][1][1] = e.read_shift(4), a.push(n[o][1]));
			break;
		case "PtgList":
		case "PtgElfRadicalS":
		case "PtgElfColS":
		case "PtgElfColSV": throw "Unsupported " + n[o][0];
		default: break;
	}
	return t = i - e.l, t !== 0 && a.push(mr(e, t)), a;
}
function Ad(e, t, n) {
	for (var r = e.l + t, i, a, o = []; r != e.l;) t = r - e.l, a = e[e.l], i = Td[a] || Td[Ed[a]], (a === 24 || a === 25) && (i = (a === 24 ? Dd : Od)[e[e.l + 1]]), !i || !i.f ? mr(e, t) : o.push([i.n, i.f(e, t, n)]);
	return o;
}
function jd(e) {
	for (var t = [], n = 0; n < e.length; ++n) {
		for (var r = e[n], i = [], a = 0; a < r.length; ++a) {
			var o = r[a];
			if (o) switch (o[0]) {
				case 2:
					i.push("\"" + o[1].replace(/"/g, "\"\"") + "\"");
					break;
				default: i.push(o[1]);
			}
			else i.push("");
		}
		t.push(i.join(","));
	}
	return t.join(";");
}
var Md = {
	PtgAdd: "+",
	PtgConcat: "&",
	PtgDiv: "/",
	PtgEq: "=",
	PtgGe: ">=",
	PtgGt: ">",
	PtgLe: "<=",
	PtgLt: "<",
	PtgMul: "*",
	PtgNe: "<>",
	PtgPower: "^",
	PtgSub: "-"
};
function Nd(e, t) {
	var n = e.lastIndexOf("!"), r = t.lastIndexOf("!");
	return n == -1 && r == -1 ? e + ":" + t : n > 0 && r > 0 && e.slice(0, n).toLowerCase() == t.slice(0, r).toLowerCase() ? e + ":" + t.slice(r + 1) : (console.error("Cannot hydrate range", e, t), e + ":" + t);
}
function Pd(e, t, n) {
	if (!e) return "SH33TJSERR0";
	if (n.biff > 8 && (!e.XTI || !e.XTI[t])) return e.SheetNames[t];
	if (!e.XTI) return "SH33TJSERR6";
	var r = e.XTI[t];
	if (n.biff < 8) return t > 1e4 && (t -= 65536), t < 0 && (t = -t), t == 0 ? "" : e.XTI[t - 1];
	if (!r) return "SH33TJSERR1";
	var i = "";
	if (n.biff > 8) switch (e[r[0]][0]) {
		case 357: return i = r[1] == -1 ? "#REF" : e.SheetNames[r[1]], r[1] == r[2] ? i : i + ":" + e.SheetNames[r[2]];
		case 358: return n.SID == null ? "SH33TJSSAME" + e[r[0]][0] : e.SheetNames[n.SID];
		case 355:
		default: return "SH33TJSSRC" + e[r[0]][0];
	}
	switch (e[r[0]][0][0]) {
		case 1025: return i = r[1] == -1 ? "#REF" : e.SheetNames[r[1]] || "SH33TJSERR3", r[1] == r[2] ? i : i + ":" + e.SheetNames[r[2]];
		case 14849: return e[r[0]].slice(1).map(function(e) {
			return e.Name;
		}).join(";;");
		default: return e[r[0]][0][3] ? (i = r[1] == -1 ? "#REF" : e[r[0]][0][3][r[1]] || "SH33TJSERR4", r[1] == r[2] ? i : i + ":" + e[r[0]][0][3][r[2]]) : "SH33TJSERR2";
	}
}
function Fd(e, t, n) {
	var r = Pd(e, t, n);
	return r == "#REF" ? r : Nr(r, n);
}
function Id(e, t, n, r, i) {
	var a = i && i.biff || 8, o = {
		s: {
			c: 0,
			r: 0
		},
		e: {
			c: 0,
			r: 0
		}
	}, s = [], c, l, u, d = 0, f = 0, p, m = "";
	if (!e[0] || !e[0][0]) return "";
	for (var h = -1, g = "", _ = 0, v = e[0].length; _ < v; ++_) {
		var y = e[0][_];
		switch (y[0]) {
			case "PtgUminus":
				s.push("-" + s.pop());
				break;
			case "PtgUplus":
				s.push("+" + s.pop());
				break;
			case "PtgPercent":
				s.push(s.pop() + "%");
				break;
			case "PtgAdd":
			case "PtgConcat":
			case "PtgDiv":
			case "PtgEq":
			case "PtgGe":
			case "PtgGt":
			case "PtgLe":
			case "PtgLt":
			case "PtgMul":
			case "PtgNe":
			case "PtgPower":
			case "PtgSub":
				if (c = s.pop(), l = s.pop(), h >= 0) {
					switch (e[0][h][1][0]) {
						case 0:
							g = _t(" ", e[0][h][1][1]);
							break;
						case 1:
							g = _t("\r", e[0][h][1][1]);
							break;
						default: if (g = "", i.WTF) throw Error("Unexpected PtgAttrSpaceType " + e[0][h][1][0]);
					}
					l += g, h = -1;
				}
				s.push(l + Md[y[0]] + c);
				break;
			case "PtgIsect":
				c = s.pop(), l = s.pop(), s.push(l + " " + c);
				break;
			case "PtgUnion":
				c = s.pop(), l = s.pop(), s.push(l + "," + c);
				break;
			case "PtgRange":
				c = s.pop(), l = s.pop(), s.push(Nd(l, c));
				break;
			case "PtgAttrChoose": break;
			case "PtgAttrGoto": break;
			case "PtgAttrIf": break;
			case "PtgAttrIfError": break;
			case "PtgRef":
				u = vr(y[1][1], o, i), s.push(br(u, a));
				break;
			case "PtgRefN":
				u = n ? vr(y[1][1], n, i) : y[1][1], s.push(br(u, a));
				break;
			case "PtgRef3d":
				d = y[1][1], u = vr(y[1][2], o, i), m = Fd(r, d, i), s.push(m + "!" + br(u, a));
				break;
			case "PtgFunc":
			case "PtgFuncVar":
				var b = y[1][0], x = y[1][1];
				b || (b = 0), b &= 127;
				var S = b == 0 ? [] : s.slice(-b);
				s.length -= b, x === "User" && (x = S.shift()), s.push(x + "(" + S.join(",") + ")");
				break;
			case "PtgBool":
				s.push(y[1] ? "TRUE" : "FALSE");
				break;
			case "PtgInt":
				s.push(y[1]);
				break;
			case "PtgNum":
				s.push(String(y[1]));
				break;
			case "PtgStr":
				s.push("\"" + y[1].replace(/"/g, "\"\"") + "\"");
				break;
			case "PtgErr":
				s.push(y[1]);
				break;
			case "PtgAreaN":
				p = yr(y[1][1], n ? { s: n } : o, i), s.push(xr(p, i));
				break;
			case "PtgArea":
				p = yr(y[1][1], o, i), s.push(xr(p, i));
				break;
			case "PtgArea3d":
				d = y[1][1], p = y[1][2], m = Fd(r, d, i), s.push(m + "!" + xr(p, i));
				break;
			case "PtgAttrSum":
				s.push("SUM(" + s.pop() + ")");
				break;
			case "PtgAttrBaxcel":
			case "PtgAttrSemi": break;
			case "PtgName":
				f = y[1][2];
				var C = (r.names || [])[f - 1] || (r[0] || [])[f], w = C ? C.Name : "SH33TJSNAME" + String(f);
				w && w.slice(0, 6) == "_xlfn." && !i.xlfn && (w = w.slice(6)), s.push(w);
				break;
			case "PtgNameX":
				var T = y[1][1];
				f = y[1][2];
				var E;
				if (i.biff <= 5) T < 0 && (T = -T), r[T] && (E = r[T][f]);
				else {
					var D = "";
					if (((r[T] || [])[0] || [])[0] == 14849 || (((r[T] || [])[0] || [])[0] == 1025 ? r[T][f] && r[T][f].itab > 0 && (D = r.SheetNames[r[T][f].itab - 1] + "!") : D = r.SheetNames[f - 1] + "!"), r[T] && r[T][f]) D += r[T][f].Name;
					else if (r[0] && r[0][f]) D += r[0][f].Name;
					else {
						var O = (Pd(r, T, i) || "").split(";;");
						O[f - 1] ? D = O[f - 1] : D += "SH33TJSERRX";
					}
					s.push(D);
					break;
				}
				E || (E = { Name: "SH33TJSERRY" }), s.push(E.Name);
				break;
			case "PtgParen":
				var k = "(", A = ")";
				if (h >= 0) {
					switch (g = "", e[0][h][1][0]) {
						case 2:
							k = _t(" ", e[0][h][1][1]) + k;
							break;
						case 3:
							k = _t("\r", e[0][h][1][1]) + k;
							break;
						case 4:
							A = _t(" ", e[0][h][1][1]) + A;
							break;
						case 5:
							A = _t("\r", e[0][h][1][1]) + A;
							break;
						default: if (i.WTF) throw Error("Unexpected PtgAttrSpaceType " + e[0][h][1][0]);
					}
					h = -1;
				}
				s.push(k + s.pop() + A);
				break;
			case "PtgRefErr":
				s.push("#REF!");
				break;
			case "PtgRefErr3d":
				s.push("#REF!");
				break;
			case "PtgExp":
				u = {
					c: y[1][1],
					r: y[1][0]
				};
				var j = {
					c: n.c,
					r: n.r
				};
				if (r.sharedf[Y(u)]) {
					var ee = r.sharedf[Y(u)];
					s.push(Id(ee, o, j, r, i));
				} else {
					var M = !1;
					for (c = 0; c != r.arrayf.length; ++c) if (l = r.arrayf[c], !(u.c < l[0].s.c || u.c > l[0].e.c) && !(u.r < l[0].s.r || u.r > l[0].e.r)) {
						s.push(Id(l[1], o, j, r, i)), M = !0;
						break;
					}
					M || s.push(y[1]);
				}
				break;
			case "PtgArray":
				s.push("{" + jd(y[1]) + "}");
				break;
			case "PtgMemArea": break;
			case "PtgAttrSpace":
			case "PtgAttrSpaceSemi":
				h = _;
				break;
			case "PtgTbl": break;
			case "PtgMemErr": break;
			case "PtgMissArg":
				s.push("");
				break;
			case "PtgAreaErr":
				s.push("#REF!");
				break;
			case "PtgAreaErr3d":
				s.push("#REF!");
				break;
			case "PtgList":
				s.push("Table" + y[1].idx + "[#" + y[1].rt + "]");
				break;
			case "PtgMemAreaN":
			case "PtgMemNoMemN":
			case "PtgAttrNoop":
			case "PtgSheet":
			case "PtgEndSheet": break;
			case "PtgMemFunc": break;
			case "PtgMemNoMem": break;
			case "PtgElfCol":
			case "PtgElfColS":
			case "PtgElfColSV":
			case "PtgElfColV":
			case "PtgElfLel":
			case "PtgElfRadical":
			case "PtgElfRadicalLel":
			case "PtgElfRadicalS":
			case "PtgElfRw":
			case "PtgElfRwV": throw Error("Unsupported ELFs");
			case "PtgSxName": throw Error("Unrecognized Formula Token: " + String(y));
			default: throw Error("Unrecognized Formula Token: " + String(y));
		}
		if (i.biff != 3 && h >= 0 && [
			"PtgAttrSpace",
			"PtgAttrSpaceSemi",
			"PtgAttrGoto"
		].indexOf(e[0][_][0]) == -1) {
			y = e[0][h];
			var N = !0;
			switch (y[1][0]) {
				case 4: N = !1;
				case 0:
					g = _t(" ", y[1][1]);
					break;
				case 5: N = !1;
				case 1:
					g = _t("\r", y[1][1]);
					break;
				default: if (g = "", i.WTF) throw Error("Unexpected PtgAttrSpaceType " + y[1][0]);
			}
			s.push((N ? g : "") + s.pop() + (N ? "" : g)), h = -1;
		}
	}
	if (s.length > 1 && i.WTF) throw Error("bad formula stack");
	return s[0] == "TRUE" ? !0 : s[0] == "FALSE" ? !1 : s[0];
}
function Ld(e, t, n) {
	var r = e.l + t, i = n.biff == 2 ? 1 : 2, a, o = e.read_shift(i);
	if (o == 65535) return [[], mr(e, t - 2)];
	var s = Ad(e, o, n);
	return t !== o + i && (a = kd(e, t - o - i, s, n)), e.l = r, [s, a];
}
function Rd(e, t, n) {
	var r = e.l + t, i = n.biff == 2 ? 1 : 2, a, o = e.read_shift(i);
	if (o == 65535) return [[], mr(e, t - 2)];
	var s = Ad(e, o, n);
	return t !== o + i && (a = kd(e, t - o - i, s, n)), e.l = r, [s, a];
}
function zd(e, t, n, r) {
	var i = e.l + t, a = Ad(e, r, n), o;
	return i !== e.l && (o = kd(e, i - e.l, a, n)), [a, o];
}
function Bd(e, t, n) {
	var r = e.l + t, i, a = e.read_shift(2), o = Ad(e, a, n);
	return a == 65535 ? [[], mr(e, t - 2)] : (t !== a + 2 && (i = kd(e, r - a - 2, o, n)), [o, i]);
}
function Vd(e) {
	var t;
	if (nr(e, e.l + 6) !== 65535) return [ti(e), "n"];
	switch (e[e.l]) {
		case 0: return e.l += 8, ["String", "s"];
		case 1: return t = e[e.l + 2] === 1, e.l += 8, [t, "b"];
		case 2: return t = e[e.l + 2], e.l += 8, [t, "e"];
		case 3: return e.l += 8, ["", "s"];
	}
	return [];
}
function Hd(e, t, n) {
	var r = e.l + t, i = Oa(e, 6, n), a = Vd(e, 8), o = e.read_shift(1);
	n.biff != 2 && (e.read_shift(1), n.biff >= 5 && e.read_shift(4));
	var s = Rd(e, r - e.l, n);
	return {
		cell: i,
		val: a[0],
		formula: s,
		shared: o >> 3 & 1,
		tt: a[1]
	};
}
function Ud(e, t, n) {
	var r = Ad(e, e.read_shift(4), n), i = e.read_shift(4);
	return [r, i > 0 ? kd(e, i, r, n) : null];
}
var Wd = Ud, Gd = Ud, Kd = Ud, qd = Ud, Jd = {
	0: "BEEP",
	1: "OPEN",
	2: "OPEN.LINKS",
	3: "CLOSE.ALL",
	4: "SAVE",
	5: "SAVE.AS",
	6: "FILE.DELETE",
	7: "PAGE.SETUP",
	8: "PRINT",
	9: "PRINTER.SETUP",
	10: "QUIT",
	11: "NEW.WINDOW",
	12: "ARRANGE.ALL",
	13: "WINDOW.SIZE",
	14: "WINDOW.MOVE",
	15: "FULL",
	16: "CLOSE",
	17: "RUN",
	22: "SET.PRINT.AREA",
	23: "SET.PRINT.TITLES",
	24: "SET.PAGE.BREAK",
	25: "REMOVE.PAGE.BREAK",
	26: "FONT",
	27: "DISPLAY",
	28: "PROTECT.DOCUMENT",
	29: "PRECISION",
	30: "A1.R1C1",
	31: "CALCULATE.NOW",
	32: "CALCULATION",
	34: "DATA.FIND",
	35: "EXTRACT",
	36: "DATA.DELETE",
	37: "SET.DATABASE",
	38: "SET.CRITERIA",
	39: "SORT",
	40: "DATA.SERIES",
	41: "TABLE",
	42: "FORMAT.NUMBER",
	43: "ALIGNMENT",
	44: "STYLE",
	45: "BORDER",
	46: "CELL.PROTECTION",
	47: "COLUMN.WIDTH",
	48: "UNDO",
	49: "CUT",
	50: "COPY",
	51: "PASTE",
	52: "CLEAR",
	53: "PASTE.SPECIAL",
	54: "EDIT.DELETE",
	55: "INSERT",
	56: "FILL.RIGHT",
	57: "FILL.DOWN",
	61: "DEFINE.NAME",
	62: "CREATE.NAMES",
	63: "FORMULA.GOTO",
	64: "FORMULA.FIND",
	65: "SELECT.LAST.CELL",
	66: "SHOW.ACTIVE.CELL",
	67: "GALLERY.AREA",
	68: "GALLERY.BAR",
	69: "GALLERY.COLUMN",
	70: "GALLERY.LINE",
	71: "GALLERY.PIE",
	72: "GALLERY.SCATTER",
	73: "COMBINATION",
	74: "PREFERRED",
	75: "ADD.OVERLAY",
	76: "GRIDLINES",
	77: "SET.PREFERRED",
	78: "AXES",
	79: "LEGEND",
	80: "ATTACH.TEXT",
	81: "ADD.ARROW",
	82: "SELECT.CHART",
	83: "SELECT.PLOT.AREA",
	84: "PATTERNS",
	85: "MAIN.CHART",
	86: "OVERLAY",
	87: "SCALE",
	88: "FORMAT.LEGEND",
	89: "FORMAT.TEXT",
	90: "EDIT.REPEAT",
	91: "PARSE",
	92: "JUSTIFY",
	93: "HIDE",
	94: "UNHIDE",
	95: "WORKSPACE",
	96: "FORMULA",
	97: "FORMULA.FILL",
	98: "FORMULA.ARRAY",
	99: "DATA.FIND.NEXT",
	100: "DATA.FIND.PREV",
	101: "FORMULA.FIND.NEXT",
	102: "FORMULA.FIND.PREV",
	103: "ACTIVATE",
	104: "ACTIVATE.NEXT",
	105: "ACTIVATE.PREV",
	106: "UNLOCKED.NEXT",
	107: "UNLOCKED.PREV",
	108: "COPY.PICTURE",
	109: "SELECT",
	110: "DELETE.NAME",
	111: "DELETE.FORMAT",
	112: "VLINE",
	113: "HLINE",
	114: "VPAGE",
	115: "HPAGE",
	116: "VSCROLL",
	117: "HSCROLL",
	118: "ALERT",
	119: "NEW",
	120: "CANCEL.COPY",
	121: "SHOW.CLIPBOARD",
	122: "MESSAGE",
	124: "PASTE.LINK",
	125: "APP.ACTIVATE",
	126: "DELETE.ARROW",
	127: "ROW.HEIGHT",
	128: "FORMAT.MOVE",
	129: "FORMAT.SIZE",
	130: "FORMULA.REPLACE",
	131: "SEND.KEYS",
	132: "SELECT.SPECIAL",
	133: "APPLY.NAMES",
	134: "REPLACE.FONT",
	135: "FREEZE.PANES",
	136: "SHOW.INFO",
	137: "SPLIT",
	138: "ON.WINDOW",
	139: "ON.DATA",
	140: "DISABLE.INPUT",
	142: "OUTLINE",
	143: "LIST.NAMES",
	144: "FILE.CLOSE",
	145: "SAVE.WORKBOOK",
	146: "DATA.FORM",
	147: "COPY.CHART",
	148: "ON.TIME",
	149: "WAIT",
	150: "FORMAT.FONT",
	151: "FILL.UP",
	152: "FILL.LEFT",
	153: "DELETE.OVERLAY",
	155: "SHORT.MENUS",
	159: "SET.UPDATE.STATUS",
	161: "COLOR.PALETTE",
	162: "DELETE.STYLE",
	163: "WINDOW.RESTORE",
	164: "WINDOW.MAXIMIZE",
	166: "CHANGE.LINK",
	167: "CALCULATE.DOCUMENT",
	168: "ON.KEY",
	169: "APP.RESTORE",
	170: "APP.MOVE",
	171: "APP.SIZE",
	172: "APP.MINIMIZE",
	173: "APP.MAXIMIZE",
	174: "BRING.TO.FRONT",
	175: "SEND.TO.BACK",
	185: "MAIN.CHART.TYPE",
	186: "OVERLAY.CHART.TYPE",
	187: "SELECT.END",
	188: "OPEN.MAIL",
	189: "SEND.MAIL",
	190: "STANDARD.FONT",
	191: "CONSOLIDATE",
	192: "SORT.SPECIAL",
	193: "GALLERY.3D.AREA",
	194: "GALLERY.3D.COLUMN",
	195: "GALLERY.3D.LINE",
	196: "GALLERY.3D.PIE",
	197: "VIEW.3D",
	198: "GOAL.SEEK",
	199: "WORKGROUP",
	200: "FILL.GROUP",
	201: "UPDATE.LINK",
	202: "PROMOTE",
	203: "DEMOTE",
	204: "SHOW.DETAIL",
	206: "UNGROUP",
	207: "OBJECT.PROPERTIES",
	208: "SAVE.NEW.OBJECT",
	209: "SHARE",
	210: "SHARE.NAME",
	211: "DUPLICATE",
	212: "APPLY.STYLE",
	213: "ASSIGN.TO.OBJECT",
	214: "OBJECT.PROTECTION",
	215: "HIDE.OBJECT",
	216: "SET.EXTRACT",
	217: "CREATE.PUBLISHER",
	218: "SUBSCRIBE.TO",
	219: "ATTRIBUTES",
	220: "SHOW.TOOLBAR",
	222: "PRINT.PREVIEW",
	223: "EDIT.COLOR",
	224: "SHOW.LEVELS",
	225: "FORMAT.MAIN",
	226: "FORMAT.OVERLAY",
	227: "ON.RECALC",
	228: "EDIT.SERIES",
	229: "DEFINE.STYLE",
	240: "LINE.PRINT",
	243: "ENTER.DATA",
	249: "GALLERY.RADAR",
	250: "MERGE.STYLES",
	251: "EDITION.OPTIONS",
	252: "PASTE.PICTURE",
	253: "PASTE.PICTURE.LINK",
	254: "SPELLING",
	256: "ZOOM",
	259: "INSERT.OBJECT",
	260: "WINDOW.MINIMIZE",
	265: "SOUND.NOTE",
	266: "SOUND.PLAY",
	267: "FORMAT.SHAPE",
	268: "EXTEND.POLYGON",
	269: "FORMAT.AUTO",
	272: "GALLERY.3D.BAR",
	273: "GALLERY.3D.SURFACE",
	274: "FILL.AUTO",
	276: "CUSTOMIZE.TOOLBAR",
	277: "ADD.TOOL",
	278: "EDIT.OBJECT",
	279: "ON.DOUBLECLICK",
	280: "ON.ENTRY",
	281: "WORKBOOK.ADD",
	282: "WORKBOOK.MOVE",
	283: "WORKBOOK.COPY",
	284: "WORKBOOK.OPTIONS",
	285: "SAVE.WORKSPACE",
	288: "CHART.WIZARD",
	289: "DELETE.TOOL",
	290: "MOVE.TOOL",
	291: "WORKBOOK.SELECT",
	292: "WORKBOOK.ACTIVATE",
	293: "ASSIGN.TO.TOOL",
	295: "COPY.TOOL",
	296: "RESET.TOOL",
	297: "CONSTRAIN.NUMERIC",
	298: "PASTE.TOOL",
	302: "WORKBOOK.NEW",
	305: "SCENARIO.CELLS",
	306: "SCENARIO.DELETE",
	307: "SCENARIO.ADD",
	308: "SCENARIO.EDIT",
	309: "SCENARIO.SHOW",
	310: "SCENARIO.SHOW.NEXT",
	311: "SCENARIO.SUMMARY",
	312: "PIVOT.TABLE.WIZARD",
	313: "PIVOT.FIELD.PROPERTIES",
	314: "PIVOT.FIELD",
	315: "PIVOT.ITEM",
	316: "PIVOT.ADD.FIELDS",
	318: "OPTIONS.CALCULATION",
	319: "OPTIONS.EDIT",
	320: "OPTIONS.VIEW",
	321: "ADDIN.MANAGER",
	322: "MENU.EDITOR",
	323: "ATTACH.TOOLBARS",
	324: "VBAActivate",
	325: "OPTIONS.CHART",
	328: "VBA.INSERT.FILE",
	330: "VBA.PROCEDURE.DEFINITION",
	336: "ROUTING.SLIP",
	338: "ROUTE.DOCUMENT",
	339: "MAIL.LOGON",
	342: "INSERT.PICTURE",
	343: "EDIT.TOOL",
	344: "GALLERY.DOUGHNUT",
	350: "CHART.TREND",
	352: "PIVOT.ITEM.PROPERTIES",
	354: "WORKBOOK.INSERT",
	355: "OPTIONS.TRANSITION",
	356: "OPTIONS.GENERAL",
	370: "FILTER.ADVANCED",
	373: "MAIL.ADD.MAILER",
	374: "MAIL.DELETE.MAILER",
	375: "MAIL.REPLY",
	376: "MAIL.REPLY.ALL",
	377: "MAIL.FORWARD",
	378: "MAIL.NEXT.LETTER",
	379: "DATA.LABEL",
	380: "INSERT.TITLE",
	381: "FONT.PROPERTIES",
	382: "MACRO.OPTIONS",
	383: "WORKBOOK.HIDE",
	384: "WORKBOOK.UNHIDE",
	385: "WORKBOOK.DELETE",
	386: "WORKBOOK.NAME",
	388: "GALLERY.CUSTOM",
	390: "ADD.CHART.AUTOFORMAT",
	391: "DELETE.CHART.AUTOFORMAT",
	392: "CHART.ADD.DATA",
	393: "AUTO.OUTLINE",
	394: "TAB.ORDER",
	395: "SHOW.DIALOG",
	396: "SELECT.ALL",
	397: "UNGROUP.SHEETS",
	398: "SUBTOTAL.CREATE",
	399: "SUBTOTAL.REMOVE",
	400: "RENAME.OBJECT",
	412: "WORKBOOK.SCROLL",
	413: "WORKBOOK.NEXT",
	414: "WORKBOOK.PREV",
	415: "WORKBOOK.TAB.SPLIT",
	416: "FULL.SCREEN",
	417: "WORKBOOK.PROTECT",
	420: "SCROLLBAR.PROPERTIES",
	421: "PIVOT.SHOW.PAGES",
	422: "TEXT.TO.COLUMNS",
	423: "FORMAT.CHARTTYPE",
	424: "LINK.FORMAT",
	425: "TRACER.DISPLAY",
	430: "TRACER.NAVIGATE",
	431: "TRACER.CLEAR",
	432: "TRACER.ERROR",
	433: "PIVOT.FIELD.GROUP",
	434: "PIVOT.FIELD.UNGROUP",
	435: "CHECKBOX.PROPERTIES",
	436: "LABEL.PROPERTIES",
	437: "LISTBOX.PROPERTIES",
	438: "EDITBOX.PROPERTIES",
	439: "PIVOT.REFRESH",
	440: "LINK.COMBO",
	441: "OPEN.TEXT",
	442: "HIDE.DIALOG",
	443: "SET.DIALOG.FOCUS",
	444: "ENABLE.OBJECT",
	445: "PUSHBUTTON.PROPERTIES",
	446: "SET.DIALOG.DEFAULT",
	447: "FILTER",
	448: "FILTER.SHOW.ALL",
	449: "CLEAR.OUTLINE",
	450: "FUNCTION.WIZARD",
	451: "ADD.LIST.ITEM",
	452: "SET.LIST.ITEM",
	453: "REMOVE.LIST.ITEM",
	454: "SELECT.LIST.ITEM",
	455: "SET.CONTROL.VALUE",
	456: "SAVE.COPY.AS",
	458: "OPTIONS.LISTS.ADD",
	459: "OPTIONS.LISTS.DELETE",
	460: "SERIES.AXES",
	461: "SERIES.X",
	462: "SERIES.Y",
	463: "ERRORBAR.X",
	464: "ERRORBAR.Y",
	465: "FORMAT.CHART",
	466: "SERIES.ORDER",
	467: "MAIL.LOGOFF",
	468: "CLEAR.ROUTING.SLIP",
	469: "APP.ACTIVATE.MICROSOFT",
	470: "MAIL.EDIT.MAILER",
	471: "ON.SHEET",
	472: "STANDARD.WIDTH",
	473: "SCENARIO.MERGE",
	474: "SUMMARY.INFO",
	475: "FIND.FILE",
	476: "ACTIVE.CELL.FONT",
	477: "ENABLE.TIPWIZARD",
	478: "VBA.MAKE.ADDIN",
	480: "INSERTDATATABLE",
	481: "WORKGROUP.OPTIONS",
	482: "MAIL.SEND.MAILER",
	485: "AUTOCORRECT",
	489: "POST.DOCUMENT",
	491: "PICKLIST",
	493: "VIEW.SHOW",
	494: "VIEW.DEFINE",
	495: "VIEW.DELETE",
	509: "SHEET.BACKGROUND",
	510: "INSERT.MAP.OBJECT",
	511: "OPTIONS.MENONO",
	517: "MSOCHECKS",
	518: "NORMAL",
	519: "LAYOUT",
	520: "RM.PRINT.AREA",
	521: "CLEAR.PRINT.AREA",
	522: "ADD.PRINT.AREA",
	523: "MOVE.BRK",
	545: "HIDECURR.NOTE",
	546: "HIDEALL.NOTES",
	547: "DELETE.NOTE",
	548: "TRAVERSE.NOTES",
	549: "ACTIVATE.NOTES",
	620: "PROTECT.REVISIONS",
	621: "UNPROTECT.REVISIONS",
	647: "OPTIONS.ME",
	653: "WEB.PUBLISH",
	667: "NEWWEBQUERY",
	673: "PIVOT.TABLE.CHART",
	753: "OPTIONS.SAVE",
	755: "OPTIONS.SPELL",
	808: "HIDEALL.INKANNOTS"
}, Yd = {
	0: "COUNT",
	1: "IF",
	2: "ISNA",
	3: "ISERROR",
	4: "SUM",
	5: "AVERAGE",
	6: "MIN",
	7: "MAX",
	8: "ROW",
	9: "COLUMN",
	10: "NA",
	11: "NPV",
	12: "STDEV",
	13: "DOLLAR",
	14: "FIXED",
	15: "SIN",
	16: "COS",
	17: "TAN",
	18: "ATAN",
	19: "PI",
	20: "SQRT",
	21: "EXP",
	22: "LN",
	23: "LOG10",
	24: "ABS",
	25: "INT",
	26: "SIGN",
	27: "ROUND",
	28: "LOOKUP",
	29: "INDEX",
	30: "REPT",
	31: "MID",
	32: "LEN",
	33: "VALUE",
	34: "TRUE",
	35: "FALSE",
	36: "AND",
	37: "OR",
	38: "NOT",
	39: "MOD",
	40: "DCOUNT",
	41: "DSUM",
	42: "DAVERAGE",
	43: "DMIN",
	44: "DMAX",
	45: "DSTDEV",
	46: "VAR",
	47: "DVAR",
	48: "TEXT",
	49: "LINEST",
	50: "TREND",
	51: "LOGEST",
	52: "GROWTH",
	53: "GOTO",
	54: "HALT",
	55: "RETURN",
	56: "PV",
	57: "FV",
	58: "NPER",
	59: "PMT",
	60: "RATE",
	61: "MIRR",
	62: "IRR",
	63: "RAND",
	64: "MATCH",
	65: "DATE",
	66: "TIME",
	67: "DAY",
	68: "MONTH",
	69: "YEAR",
	70: "WEEKDAY",
	71: "HOUR",
	72: "MINUTE",
	73: "SECOND",
	74: "NOW",
	75: "AREAS",
	76: "ROWS",
	77: "COLUMNS",
	78: "OFFSET",
	79: "ABSREF",
	80: "RELREF",
	81: "ARGUMENT",
	82: "SEARCH",
	83: "TRANSPOSE",
	84: "ERROR",
	85: "STEP",
	86: "TYPE",
	87: "ECHO",
	88: "SET.NAME",
	89: "CALLER",
	90: "DEREF",
	91: "WINDOWS",
	92: "SERIES",
	93: "DOCUMENTS",
	94: "ACTIVE.CELL",
	95: "SELECTION",
	96: "RESULT",
	97: "ATAN2",
	98: "ASIN",
	99: "ACOS",
	100: "CHOOSE",
	101: "HLOOKUP",
	102: "VLOOKUP",
	103: "LINKS",
	104: "INPUT",
	105: "ISREF",
	106: "GET.FORMULA",
	107: "GET.NAME",
	108: "SET.VALUE",
	109: "LOG",
	110: "EXEC",
	111: "CHAR",
	112: "LOWER",
	113: "UPPER",
	114: "PROPER",
	115: "LEFT",
	116: "RIGHT",
	117: "EXACT",
	118: "TRIM",
	119: "REPLACE",
	120: "SUBSTITUTE",
	121: "CODE",
	122: "NAMES",
	123: "DIRECTORY",
	124: "FIND",
	125: "CELL",
	126: "ISERR",
	127: "ISTEXT",
	128: "ISNUMBER",
	129: "ISBLANK",
	130: "T",
	131: "N",
	132: "FOPEN",
	133: "FCLOSE",
	134: "FSIZE",
	135: "FREADLN",
	136: "FREAD",
	137: "FWRITELN",
	138: "FWRITE",
	139: "FPOS",
	140: "DATEVALUE",
	141: "TIMEVALUE",
	142: "SLN",
	143: "SYD",
	144: "DDB",
	145: "GET.DEF",
	146: "REFTEXT",
	147: "TEXTREF",
	148: "INDIRECT",
	149: "REGISTER",
	150: "CALL",
	151: "ADD.BAR",
	152: "ADD.MENU",
	153: "ADD.COMMAND",
	154: "ENABLE.COMMAND",
	155: "CHECK.COMMAND",
	156: "RENAME.COMMAND",
	157: "SHOW.BAR",
	158: "DELETE.MENU",
	159: "DELETE.COMMAND",
	160: "GET.CHART.ITEM",
	161: "DIALOG.BOX",
	162: "CLEAN",
	163: "MDETERM",
	164: "MINVERSE",
	165: "MMULT",
	166: "FILES",
	167: "IPMT",
	168: "PPMT",
	169: "COUNTA",
	170: "CANCEL.KEY",
	171: "FOR",
	172: "WHILE",
	173: "BREAK",
	174: "NEXT",
	175: "INITIATE",
	176: "REQUEST",
	177: "POKE",
	178: "EXECUTE",
	179: "TERMINATE",
	180: "RESTART",
	181: "HELP",
	182: "GET.BAR",
	183: "PRODUCT",
	184: "FACT",
	185: "GET.CELL",
	186: "GET.WORKSPACE",
	187: "GET.WINDOW",
	188: "GET.DOCUMENT",
	189: "DPRODUCT",
	190: "ISNONTEXT",
	191: "GET.NOTE",
	192: "NOTE",
	193: "STDEVP",
	194: "VARP",
	195: "DSTDEVP",
	196: "DVARP",
	197: "TRUNC",
	198: "ISLOGICAL",
	199: "DCOUNTA",
	200: "DELETE.BAR",
	201: "UNREGISTER",
	204: "USDOLLAR",
	205: "FINDB",
	206: "SEARCHB",
	207: "REPLACEB",
	208: "LEFTB",
	209: "RIGHTB",
	210: "MIDB",
	211: "LENB",
	212: "ROUNDUP",
	213: "ROUNDDOWN",
	214: "ASC",
	215: "DBCS",
	216: "RANK",
	219: "ADDRESS",
	220: "DAYS360",
	221: "TODAY",
	222: "VDB",
	223: "ELSE",
	224: "ELSE.IF",
	225: "END.IF",
	226: "FOR.CELL",
	227: "MEDIAN",
	228: "SUMPRODUCT",
	229: "SINH",
	230: "COSH",
	231: "TANH",
	232: "ASINH",
	233: "ACOSH",
	234: "ATANH",
	235: "DGET",
	236: "CREATE.OBJECT",
	237: "VOLATILE",
	238: "LAST.ERROR",
	239: "CUSTOM.UNDO",
	240: "CUSTOM.REPEAT",
	241: "FORMULA.CONVERT",
	242: "GET.LINK.INFO",
	243: "TEXT.BOX",
	244: "INFO",
	245: "GROUP",
	246: "GET.OBJECT",
	247: "DB",
	248: "PAUSE",
	251: "RESUME",
	252: "FREQUENCY",
	253: "ADD.TOOLBAR",
	254: "DELETE.TOOLBAR",
	255: "User",
	256: "RESET.TOOLBAR",
	257: "EVALUATE",
	258: "GET.TOOLBAR",
	259: "GET.TOOL",
	260: "SPELLING.CHECK",
	261: "ERROR.TYPE",
	262: "APP.TITLE",
	263: "WINDOW.TITLE",
	264: "SAVE.TOOLBAR",
	265: "ENABLE.TOOL",
	266: "PRESS.TOOL",
	267: "REGISTER.ID",
	268: "GET.WORKBOOK",
	269: "AVEDEV",
	270: "BETADIST",
	271: "GAMMALN",
	272: "BETAINV",
	273: "BINOMDIST",
	274: "CHIDIST",
	275: "CHIINV",
	276: "COMBIN",
	277: "CONFIDENCE",
	278: "CRITBINOM",
	279: "EVEN",
	280: "EXPONDIST",
	281: "FDIST",
	282: "FINV",
	283: "FISHER",
	284: "FISHERINV",
	285: "FLOOR",
	286: "GAMMADIST",
	287: "GAMMAINV",
	288: "CEILING",
	289: "HYPGEOMDIST",
	290: "LOGNORMDIST",
	291: "LOGINV",
	292: "NEGBINOMDIST",
	293: "NORMDIST",
	294: "NORMSDIST",
	295: "NORMINV",
	296: "NORMSINV",
	297: "STANDARDIZE",
	298: "ODD",
	299: "PERMUT",
	300: "POISSON",
	301: "TDIST",
	302: "WEIBULL",
	303: "SUMXMY2",
	304: "SUMX2MY2",
	305: "SUMX2PY2",
	306: "CHITEST",
	307: "CORREL",
	308: "COVAR",
	309: "FORECAST",
	310: "FTEST",
	311: "INTERCEPT",
	312: "PEARSON",
	313: "RSQ",
	314: "STEYX",
	315: "SLOPE",
	316: "TTEST",
	317: "PROB",
	318: "DEVSQ",
	319: "GEOMEAN",
	320: "HARMEAN",
	321: "SUMSQ",
	322: "KURT",
	323: "SKEW",
	324: "ZTEST",
	325: "LARGE",
	326: "SMALL",
	327: "QUARTILE",
	328: "PERCENTILE",
	329: "PERCENTRANK",
	330: "MODE",
	331: "TRIMMEAN",
	332: "TINV",
	334: "MOVIE.COMMAND",
	335: "GET.MOVIE",
	336: "CONCATENATE",
	337: "POWER",
	338: "PIVOT.ADD.DATA",
	339: "GET.PIVOT.TABLE",
	340: "GET.PIVOT.FIELD",
	341: "GET.PIVOT.ITEM",
	342: "RADIANS",
	343: "DEGREES",
	344: "SUBTOTAL",
	345: "SUMIF",
	346: "COUNTIF",
	347: "COUNTBLANK",
	348: "SCENARIO.GET",
	349: "OPTIONS.LISTS.GET",
	350: "ISPMT",
	351: "DATEDIF",
	352: "DATESTRING",
	353: "NUMBERSTRING",
	354: "ROMAN",
	355: "OPEN.DIALOG",
	356: "SAVE.DIALOG",
	357: "VIEW.GET",
	358: "GETPIVOTDATA",
	359: "HYPERLINK",
	360: "PHONETIC",
	361: "AVERAGEA",
	362: "MAXA",
	363: "MINA",
	364: "STDEVPA",
	365: "VARPA",
	366: "STDEVA",
	367: "VARA",
	368: "BAHTTEXT",
	369: "THAIDAYOFWEEK",
	370: "THAIDIGIT",
	371: "THAIMONTHOFYEAR",
	372: "THAINUMSOUND",
	373: "THAINUMSTRING",
	374: "THAISTRINGLENGTH",
	375: "ISTHAIDIGIT",
	376: "ROUNDBAHTDOWN",
	377: "ROUNDBAHTUP",
	378: "THAIYEAR",
	379: "RTD",
	380: "CUBEVALUE",
	381: "CUBEMEMBER",
	382: "CUBEMEMBERPROPERTY",
	383: "CUBERANKEDMEMBER",
	384: "HEX2BIN",
	385: "HEX2DEC",
	386: "HEX2OCT",
	387: "DEC2BIN",
	388: "DEC2HEX",
	389: "DEC2OCT",
	390: "OCT2BIN",
	391: "OCT2HEX",
	392: "OCT2DEC",
	393: "BIN2DEC",
	394: "BIN2OCT",
	395: "BIN2HEX",
	396: "IMSUB",
	397: "IMDIV",
	398: "IMPOWER",
	399: "IMABS",
	400: "IMSQRT",
	401: "IMLN",
	402: "IMLOG2",
	403: "IMLOG10",
	404: "IMSIN",
	405: "IMCOS",
	406: "IMEXP",
	407: "IMARGUMENT",
	408: "IMCONJUGATE",
	409: "IMAGINARY",
	410: "IMREAL",
	411: "COMPLEX",
	412: "IMSUM",
	413: "IMPRODUCT",
	414: "SERIESSUM",
	415: "FACTDOUBLE",
	416: "SQRTPI",
	417: "QUOTIENT",
	418: "DELTA",
	419: "GESTEP",
	420: "ISEVEN",
	421: "ISODD",
	422: "MROUND",
	423: "ERF",
	424: "ERFC",
	425: "BESSELJ",
	426: "BESSELK",
	427: "BESSELY",
	428: "BESSELI",
	429: "XIRR",
	430: "XNPV",
	431: "PRICEMAT",
	432: "YIELDMAT",
	433: "INTRATE",
	434: "RECEIVED",
	435: "DISC",
	436: "PRICEDISC",
	437: "YIELDDISC",
	438: "TBILLEQ",
	439: "TBILLPRICE",
	440: "TBILLYIELD",
	441: "PRICE",
	442: "YIELD",
	443: "DOLLARDE",
	444: "DOLLARFR",
	445: "NOMINAL",
	446: "EFFECT",
	447: "CUMPRINC",
	448: "CUMIPMT",
	449: "EDATE",
	450: "EOMONTH",
	451: "YEARFRAC",
	452: "COUPDAYBS",
	453: "COUPDAYS",
	454: "COUPDAYSNC",
	455: "COUPNCD",
	456: "COUPNUM",
	457: "COUPPCD",
	458: "DURATION",
	459: "MDURATION",
	460: "ODDLPRICE",
	461: "ODDLYIELD",
	462: "ODDFPRICE",
	463: "ODDFYIELD",
	464: "RANDBETWEEN",
	465: "WEEKNUM",
	466: "AMORDEGRC",
	467: "AMORLINC",
	468: "CONVERT",
	724: "SHEETJS",
	469: "ACCRINT",
	470: "ACCRINTM",
	471: "WORKDAY",
	472: "NETWORKDAYS",
	473: "GCD",
	474: "MULTINOMIAL",
	475: "LCM",
	476: "FVSCHEDULE",
	477: "CUBEKPIMEMBER",
	478: "CUBESET",
	479: "CUBESETCOUNT",
	480: "IFERROR",
	481: "COUNTIFS",
	482: "SUMIFS",
	483: "AVERAGEIF",
	484: "AVERAGEIFS"
}, Xd = {
	2: 1,
	3: 1,
	10: 0,
	15: 1,
	16: 1,
	17: 1,
	18: 1,
	19: 0,
	20: 1,
	21: 1,
	22: 1,
	23: 1,
	24: 1,
	25: 1,
	26: 1,
	27: 2,
	30: 2,
	31: 3,
	32: 1,
	33: 1,
	34: 0,
	35: 0,
	38: 1,
	39: 2,
	40: 3,
	41: 3,
	42: 3,
	43: 3,
	44: 3,
	45: 3,
	47: 3,
	48: 2,
	53: 1,
	61: 3,
	63: 0,
	65: 3,
	66: 3,
	67: 1,
	68: 1,
	69: 1,
	70: 1,
	71: 1,
	72: 1,
	73: 1,
	74: 0,
	75: 1,
	76: 1,
	77: 1,
	79: 2,
	80: 2,
	83: 1,
	85: 0,
	86: 1,
	89: 0,
	90: 1,
	94: 0,
	95: 0,
	97: 2,
	98: 1,
	99: 1,
	101: 3,
	102: 3,
	105: 1,
	106: 1,
	108: 2,
	111: 1,
	112: 1,
	113: 1,
	114: 1,
	117: 2,
	118: 1,
	119: 4,
	121: 1,
	126: 1,
	127: 1,
	128: 1,
	129: 1,
	130: 1,
	131: 1,
	133: 1,
	134: 1,
	135: 1,
	136: 2,
	137: 2,
	138: 2,
	140: 1,
	141: 1,
	142: 3,
	143: 4,
	144: 4,
	161: 1,
	162: 1,
	163: 1,
	164: 1,
	165: 2,
	172: 1,
	175: 2,
	176: 2,
	177: 3,
	178: 2,
	179: 1,
	184: 1,
	186: 1,
	189: 3,
	190: 1,
	195: 3,
	196: 3,
	197: 1,
	198: 1,
	199: 3,
	201: 1,
	207: 4,
	210: 3,
	211: 1,
	212: 2,
	213: 2,
	214: 1,
	215: 1,
	225: 0,
	229: 1,
	230: 1,
	231: 1,
	232: 1,
	233: 1,
	234: 1,
	235: 3,
	244: 1,
	247: 4,
	252: 2,
	257: 1,
	261: 1,
	271: 1,
	273: 4,
	274: 2,
	275: 2,
	276: 2,
	277: 3,
	278: 3,
	279: 1,
	280: 3,
	281: 3,
	282: 3,
	283: 1,
	284: 1,
	285: 2,
	286: 4,
	287: 3,
	288: 2,
	289: 4,
	290: 3,
	291: 3,
	292: 3,
	293: 4,
	294: 1,
	295: 3,
	296: 1,
	297: 3,
	298: 1,
	299: 2,
	300: 3,
	301: 3,
	302: 4,
	303: 2,
	304: 2,
	305: 2,
	306: 2,
	307: 2,
	308: 2,
	309: 3,
	310: 2,
	311: 2,
	312: 2,
	313: 2,
	314: 2,
	315: 2,
	316: 4,
	325: 2,
	326: 2,
	327: 2,
	328: 2,
	331: 2,
	332: 2,
	337: 2,
	342: 1,
	343: 1,
	346: 2,
	347: 1,
	350: 4,
	351: 3,
	352: 1,
	353: 2,
	360: 1,
	368: 1,
	369: 1,
	370: 1,
	371: 1,
	372: 1,
	373: 1,
	374: 1,
	375: 1,
	376: 1,
	377: 1,
	378: 1,
	382: 3,
	385: 1,
	392: 1,
	393: 1,
	396: 2,
	397: 2,
	398: 2,
	399: 1,
	400: 1,
	401: 1,
	402: 1,
	403: 1,
	404: 1,
	405: 1,
	406: 1,
	407: 1,
	408: 1,
	409: 1,
	410: 1,
	414: 4,
	415: 1,
	416: 1,
	417: 2,
	420: 1,
	421: 1,
	422: 2,
	424: 1,
	425: 2,
	426: 2,
	427: 2,
	428: 2,
	430: 3,
	438: 3,
	439: 3,
	440: 3,
	443: 2,
	444: 2,
	445: 2,
	446: 2,
	447: 6,
	448: 6,
	449: 2,
	450: 2,
	464: 2,
	468: 3,
	476: 2,
	479: 1,
	480: 2,
	65535: 0
};
function Zd(e) {
	return e.slice(0, 3) == "of:" && (e = e.slice(3)), e.charCodeAt(0) == 61 && (e = e.slice(1), e.charCodeAt(0) == 61 && (e = e.slice(1))), e = e.replace(/COM\.MICROSOFT\./g, ""), e = e.replace(/\[((?:\.[A-Z]+[0-9]+)(?::\.[A-Z]+[0-9]+)?)\]/g, function(e, t) {
		return t.replace(/\./g, "");
	}), e = e.replace(/\$'([^']|'')+'/g, function(e) {
		return e.slice(1);
	}), e = e.replace(/\$([^\]\. #$]+)/g, function(e, t) {
		return t.match(/^([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])?(10[0-3]\d{4}|104[0-7]\d{3}|1048[0-4]\d{2}|10485[0-6]\d|104857[0-6]|[1-9]\d{0,5})?$/) ? e : t;
	}), e = e.replace(/\[.(#[A-Z]*[?!])\]/g, "$1"), e.replace(/[;~]/g, ",").replace(/\|/g, ";");
}
function Qd(e) {
	e = e.replace(/\$'([^']|'')+'/g, function(e) {
		return e.slice(1);
	}), e = e.replace(/\$([^\]\. #$]+)/g, function(e, t) {
		return t.match(/^([A-Z]{1,2}|[A-W][A-Z]{2}|X[A-E][A-Z]|XF[A-D])?(10[0-3]\d{4}|104[0-7]\d{3}|1048[0-4]\d{2}|10485[0-6]\d|104857[0-6]|[1-9]\d{0,5})?$/) ? e : t;
	});
	var t = e.split(":");
	return [t[0].split(".")[0], t[0].split(".")[1] + (t.length > 1 ? ":" + (t[1].split(".")[1] || t[1].split(".")[0]) : "")];
}
var $d = {}, ef = {};
function tf(e, t) {
	if (e) {
		var n = [
			.7,
			.7,
			.75,
			.75,
			.3,
			.3
		];
		t == "xlml" && (n = [
			1,
			1,
			1,
			1,
			.5,
			.5
		]), e.left == null && (e.left = n[0]), e.right == null && (e.right = n[1]), e.top == null && (e.top = n[2]), e.bottom == null && (e.bottom = n[3]), e.header == null && (e.header = n[4]), e.footer == null && (e.footer = n[5]);
	}
}
function nf(e, t) {
	return t && rt(t).forEach(function(n) {
		e[n] = gt(t[n]);
	}), e;
}
function rf(e, t) {
	return t ? (t.patternType != null && (e.patternType = t.patternType), t.fgColor != null && (e.fgColor = gt(t.fgColor)), t.bgColor != null && (e.bgColor = gt(t.bgColor)), t.gradientFill != null && (e.gradientFill = gt(t.gradientFill)), e) : e;
}
function af(e, t, n, r) {
	if (!e || !t) return null;
	var i = {};
	t.xfId != null && e.CellStyleXf && e.CellStyleXf[t.xfId] && nf(i, e.CellStyleXf[t.xfId]), nf(i, t);
	var a = {
		id: r,
		xf: gt(i)
	};
	return i.numFmtId != null && (a.numFmtId = i.numFmtId, e.NumberFmt && e.NumberFmt[i.numFmtId] != null && (a.numFmt = e.NumberFmt[i.numFmtId])), i.fontId != null && e.Fonts && e.Fonts[i.fontId] && (a.font = ic(e.Fonts[i.fontId], n)), i.fillId != null && e.Fills && e.Fills[i.fillId] && (a.fill = ic(e.Fills[i.fillId], n), rf(a, a.fill)), i.borderId != null && e.Borders && e.Borders[i.borderId] && (a.border = ic(e.Borders[i.borderId], n)), i.alignment && (a.alignment = gt(i.alignment)), i.protection && (a.protection = gt(i.protection)), a;
}
function of(e, t, n, r, i, a, o, s, c) {
	try {
		r.cellNF && (e.z = V[t]);
	} catch (e) {
		if (r.WTF) throw e;
	}
	if (!(e.t === "z" && !r.cellStyles)) {
		if (e.t === "d" && typeof e.v == "string" && (e.v = mt(e.v)), (!r || r.cellText !== !1) && e.t !== "z") try {
			if (V[t] == null && Qe(qe[t] || "General", t), e.t === "e") e.w = e.w || Ei[e.v];
			else if (t === 0) if (e.t === "n") (e.v | 0) === e.v ? e.w = e.v.toString(10) : e.w = fe(e.v);
			else if (e.t === "d") {
				var l = ct(e.v, !!o);
				(l | 0) === l ? e.w = l.toString(10) : e.w = fe(l);
			} else if (e.v === void 0) return "";
			else e.w = pe(e.v, ef);
			else e.t === "d" ? e.w = We(t, ct(e.v, !!o), ef) : e.w = We(t, e.v, ef);
		} catch (e) {
			if (r.WTF) throw e;
		}
		if (r.cellStyles) {
			if (s != null) try {
				var u = af(a, s, i, c);
				if (u) {
					e.s = u;
					return;
				}
			} catch (e) {
				if (r.WTF) throw e;
			}
			if (n != null) try {
				e.s = ic(a.Fills[n], i);
			} catch (e) {
				if (r.WTF && a.Fills) throw e;
			}
		}
	}
}
function sf(e, t) {
	return !(e.e.r < t.s.r || t.e.r < e.s.r || e.e.c < t.s.c || t.e.c < e.s.c);
}
function cf(e, t) {
	for (var n = e && e["!merges"] || [], r = [], i = e && e["!ref"] ? Pr(e["!ref"]) : null, a = {}, o = 0; o < n.length; ++o) {
		var s = n[o], c = "";
		if (!s || !s.s || !s.e) {
			r.push({
				code: "E_MERGE_RANGE",
				message: "Merge range is malformed",
				index: o
			});
			continue;
		}
		if (s.s.r < 0 || s.s.c < 0 || s.e.r < s.s.r || s.e.c < s.s.c) {
			r.push({
				code: "E_MERGE_RANGE",
				message: "Merge range is invalid",
				index: o,
				range: s
			});
			continue;
		}
		c = X(s), a[c] != null && r.push({
			code: "E_MERGE_DUP",
			message: "Merge range is duplicated",
			index: o,
			other: a[c],
			range: c
		}), a[c] = o, i && (s.s.r < i.s.r || s.s.c < i.s.c || s.e.r > i.e.r || s.e.c > i.e.c) && r.push({
			code: "E_MERGE_BOUNDS",
			message: "Merge range exceeds worksheet range",
			index: o,
			range: c,
			ref: X(i)
		});
		for (var l = 0; l < o; ++l) !n[l] || !n[l].s || !n[l].e || sf(s, n[l]) && X(n[l]) != c && r.push({
			code: "E_MERGE_OVERLAP",
			message: "Merge ranges overlap",
			index: o,
			other: l,
			range: c,
			otherRange: X(n[l])
		});
	}
	if (r.length && t && t.WTF) throw Error(r[0].message + " (" + (r[0].range || r[0].index) + ")");
	return r;
}
function lf(e, t) {
	var n = Pr(t);
	n.s.r <= n.e.r && n.s.c <= n.e.c && n.s.r >= 0 && n.s.c >= 0 && (e["!ref"] = X(n));
}
var uf = /<(?:\w+:)?mergeCell ref=["'][A-Z0-9:]+['"]\s*[\/]?>/g, df = /<(?:\w+:)?hyperlink [^<>]*>/gm, ff = /"(\w*:\w*)"/, pf = /<(?:\w+:)?col\b[^<>]*[\/]?>/g, mf = /<(?:\w:)?autoFilter[^>]*([\/]|>([\s\S]*)<\/(?:\w:)?autoFilter)>/g, hf = /<(?:\w+:)?pageMargins[^<>]*\/>/g, gf = /<(?:\w+:)?sheetPr\b[^<>]*?\/>/;
function _f(e, t, n, r, i, a, o) {
	if (!e) return e;
	r || (r = { "!id": {} }), _ != null && t.dense == null && (t.dense = _);
	var s = {};
	t.dense && (s["!data"] = []);
	var c = {
		s: {
			r: 2e6,
			c: 2e6
		},
		e: {
			r: 0,
			c: 0
		}
	}, l = "", u = "", d = Ft(e, "sheetData");
	d ? (l = e.slice(0, d.index), u = e.slice(d.index + d[0].length)) : l = u = e;
	var f = l.match(gf);
	f ? vf(f[0], s, i, n) : (f = Ft(l, "sheetPr")) && yf(f[0], f[1] || "", s, i, n, o, a);
	var p = (l.match(/<(?:\w*:)?dimension/) || { index: -1 }).index;
	if (p > 0) {
		var m = l.slice(p, p + 50).match(ff);
		m && !(t && t.nodim) && lf(s, m[1]);
	}
	var h = Ft(l, "sheetViews");
	h && h[1] && Tf(h[1], i);
	var g = [];
	if (t.cellStyles) {
		var v = l.match(pf);
		v && Sf(g, v);
	}
	d && Ef(d[1], s, t, c, a, o, i);
	var y = u.match(mf);
	y && (s["!autofilter"] = Cf(y[0]));
	var b = [], x = u.match(uf);
	if (x) for (p = 0; p != x.length; ++p) b[p] = Pr(x[p].slice(x[p].indexOf("=") + 2));
	var S = u.match(df);
	S && bf(s, S, r);
	var C = u.match(hf);
	C && (s["!margins"] = xf(K(C[0])));
	var w;
	if ((w = u.match(/<(?:\w+:)?drawing\b[^<>]*r:id="(.*?)"/)) && (s["!rel"] = w[1]), (w = u.match(/legacyDrawing r:id="(.*?)"/)) && (s["!legrel"] = w[1]), t && t.nodim && (c.s.c = c.s.r = 0), !s["!ref"] && c.e.c >= c.s.c && c.e.r >= c.s.r && (s["!ref"] = X(c)), t.sheetRows > 0 && s["!ref"]) {
		var T = Pr(s["!ref"]);
		t.sheetRows <= +T.e.r && (T.e.r = t.sheetRows - 1, T.e.r > c.e.r && (T.e.r = c.e.r), T.e.r < T.s.r && (T.s.r = T.e.r), T.e.c > c.e.c && (T.e.c = c.e.c), T.e.c < T.s.c && (T.s.c = T.e.c), s["!fullref"] = s["!ref"], s["!ref"] = X(T));
	}
	if (g.length > 0 && (s["!cols"] = g), b.length > 0) {
		s["!merges"] = b;
		var E = cf(s, { WTF: !!(t && (t.WTF || t.validateMerges)) });
		E.length && (s["!mergeErrors"] = E);
	}
	return r["!id"][s["!rel"]] && (s["!drawel"] = r["!id"][s["!rel"]]), r["!id"][s["!legrel"]] && (s["!legdrawel"] = r["!id"][s["!legrel"]]), s;
}
function vf(e, t, n, r) {
	var i = K(e);
	n.Sheets[r] || (n.Sheets[r] = {}), i.codeName && (n.Sheets[r].CodeName = q(vn(i.codeName)));
}
function yf(e, t, n, r, i) {
	vf(e.slice(0, e.indexOf(">")), n, r, i);
}
function bf(e, t, n) {
	for (var r = e["!data"] != null, i = 0; i != t.length; ++i) {
		var a = K(vn(t[i]), !0);
		if (!a.ref) return;
		var o = ((n || {})["!id"] || [])[a.id];
		o ? (a.Target = o.Target, a.location && (a.Target += "#" + q(a.location))) : (a.Target = "#" + q(a.location), o = {
			Target: a.Target,
			TargetMode: "Internal"
		}), a.Rel = o, a.tooltip && (a.Tooltip = a.tooltip, delete a.tooltip);
		for (var s = Pr(a.ref), c = s.s.r; c <= s.e.r; ++c) for (var l = s.s.c; l <= s.e.c; ++l) {
			var u = Dr(l) + Cr(c);
			r ? (e["!data"][c] || (e["!data"][c] = []), e["!data"][c][l] || (e["!data"][c][l] = {
				t: "z",
				v: void 0
			}), e["!data"][c][l].l = a) : (e[u] || (e[u] = {
				t: "z",
				v: void 0
			}), e[u].l = a);
		}
	}
}
function xf(e) {
	var t = {};
	return [
		"left",
		"right",
		"top",
		"bottom",
		"header",
		"footer"
	].forEach(function(n) {
		e[n] && (t[n] = parseFloat(e[n]));
	}), t;
}
function Sf(e, t) {
	for (var n = !1, r = 0; r != t.length; ++r) {
		var i = K(t[r], !0);
		i.hidden && (i.hidden = J(i.hidden)), i.bestFit && (i.bestFit = J(i.bestFit)), i.customWidth && (i.customWidth = J(i.customWidth));
		var a = parseInt(i.min, 10) - 1, o = parseInt(i.max, 10) - 1;
		for (i.outlineLevel && (i.level = +i.outlineLevel || 0), delete i.min, delete i.max, i.width = +i.width, !n && i.width && (n = !0, pc(i.width)), mc(i); a <= o;) e[a++] = gt(i);
	}
}
function Cf(e) {
	return { ref: (e.match(/ref=["']([^"']*)["']/) || [])[1] };
}
var wf = /<(?:\w:)?sheetView(?:[^<>a-z][^<>]*)?\/?>/g;
function Tf(e, t) {
	t.Views || (t.Views = [{}]), (e.match(wf) || []).forEach(function(e, n) {
		var r = K(e);
		t.Views[n] || (t.Views[n] = {}), +r.zoomScale && (t.Views[n].zoom = +r.zoomScale), r.rightToLeft && J(r.rightToLeft) && (t.Views[n].RTL = !0);
	});
}
var Ef = /*#__PURE__*/ (function() {
	var e = /<(?:\w+:)?c[ \/>]/, t = /<\/(?:\w+:)?row>/, n = /r=["']([^"']*)["']/, r = /ref=["']([^"']*)["']/;
	return function(i, a, o, s, c, l, u) {
		for (var d = 0, f = "", p = [], m = [], h = 0, g = 0, _ = 0, v = "", y, b, x = 0, S = 0, C, w, T = 0, E = 0, D = -1, O = Array.isArray(l.CellXf), k, A = [], j = [], ee = a["!data"] != null, M = [], N = {}, P = !1, F = !!o.sheetStubs, I = !!((u || {}).WBProps || {}).date1904, L = i.split(t), te = 0, ne = L.length; te != ne; ++te) {
			f = L[te].trim();
			var re = f.length;
			if (re !== 0) {
				var R = 0;
				outa: for (d = 0; d < re; ++d) switch (f[d]) {
					case ">":
						if (f[d - 1] != "/") {
							++d;
							break outa;
						}
						if (o && o.cellStyles) {
							if (b = K(f.slice(R, d), !0), x = b.r == null ? x + 1 : parseInt(b.r, 10), S = -1, o.sheetRows && o.sheetRows < x) continue;
							N = {}, P = !1, b.ht && (P = !0, N.hpt = parseFloat(b.ht), N.hpx = Ic(N.hpt)), b.hidden && J(b.hidden) && (P = !0, N.hidden = !0), b.outlineLevel != null && (P = !0, N.level = +b.outlineLevel), P && (M[x - 1] = N);
						}
						break;
					case "<":
						R = d;
						break;
				}
				if (R >= d) break;
				if (b = K(f.slice(R, d), !0), x = b.r == null ? x + 1 : parseInt(b.r, 10), S = -1, !(o.sheetRows && o.sheetRows < x)) {
					o.nodim || (s.s.r > x - 1 && (s.s.r = x - 1), s.e.r < x - 1 && (s.e.r = x - 1)), o && o.cellStyles && (N = {}, P = !1, b.ht && (P = !0, N.hpt = parseFloat(b.ht), N.hpx = Ic(N.hpt)), b.hidden && J(b.hidden) && (P = !0, N.hidden = !0), b.outlineLevel != null && (P = !0, N.level = +b.outlineLevel), P && (M[x - 1] = N)), p = f.slice(d).split(e);
					for (var z = 0; z != p.length && p[z].trim().charAt(0) == "<"; ++z);
					for (p = p.slice(z), d = 0; d != p.length; ++d) if (f = p[d].trim(), f.length !== 0) {
						if (m = f.match(n), h = d, g = 0, _ = 0, f = "<c " + (f.slice(0, 1) == "<" ? ">" : "") + f, m != null && m.length === 2) {
							for (h = 0, v = m[1], g = 0; g != v.length && !((_ = v.charCodeAt(g) - 64) < 1 || _ > 26); ++g) h = 26 * h + _;
							--h, S = h;
						} else ++S;
						for (g = 0; g != f.length && f.charCodeAt(g) !== 62; ++g);
						if (++g, b = K(f.slice(0, g), !0), b.r || (b.r = Y({
							r: x - 1,
							c: S
						})), v = f.slice(g), y = { t: "" }, (m = Ft(v, "v")) != null && m[1] !== "" && (y.v = q(m[1])), o.cellFormula) {
							if ((m = Ft(v, "f")) != null) {
								if (m[1] == "") m[0].indexOf("t=\"shared\"") > -1 && (w = K(m[0]), j[w.si] && (y.f = au(j[w.si][1], j[w.si][2], b.r)));
								else if (y.f = q(vn(m[1]), !0), o.xlfn || (y.f = su(y.f)), m[0].indexOf("t=\"array\"") > -1) y.F = (v.match(r) || [])[1], y.F.indexOf(":") > -1 && A.push([Pr(y.F), y.F]);
								else if (m[0].indexOf("t=\"shared\"") > -1) {
									w = K(m[0]);
									var B = q(vn(m[1]), !0);
									o.xlfn || (B = su(B)), j[parseInt(w.si, 10)] = [
										w,
										B,
										b.r
									];
								}
							} else (m = v.match(/<f[^<>]*\/>/)) && (w = K(m[0]), j[w.si] && (y.f = au(j[w.si][1], j[w.si][2], b.r)));
							var ie = jr(b.r);
							for (g = 0; g < A.length; ++g) ie.r >= A[g][0].s.r && ie.r <= A[g][0].e.r && ie.c >= A[g][0].s.c && ie.c <= A[g][0].e.c && (y.F = A[g][1]);
						}
						if (b.t == null && y.v === void 0) if (y.f || y.F) y.v = 0, y.t = "n";
						else if (F) y.t = "z";
						else continue;
						else y.t = b.t || "n";
						switch (s.s.c > S && (s.s.c = S), s.e.c < S && (s.e.c = S), y.t) {
							case "n":
								if (y.v == "" || y.v == null) {
									if (!F) continue;
									y.t = "z";
								} else y.v = parseFloat(y.v);
								break;
							case "s":
								if (y.v === void 0) {
									if (!F) continue;
									y.t = "z";
								} else C = $d[parseInt(y.v, 10)], y.v = C.t, y.r = C.r, o.cellHTML && (y.h = C.h);
								break;
							case "str":
								y.t = "s", y.v = y.v == null ? "" : q(vn(y.v), !0), o.cellHTML && (y.h = fn(y.v));
								break;
							case "inlineStr":
								m = Ft(v, "is"), y.t = "s", m != null && (C = ys(m[1])) ? (y.v = C.t, o.cellHTML && (y.h = C.h)) : y.v = "";
								break;
							case "b":
								y.v = J(y.v);
								break;
							case "d":
								o.cellDates ? y.v = mt(y.v, I) : (y.v = ct(mt(y.v, I), I), y.t = "n");
								break;
							case "e":
								(!o || o.cellText !== !1) && (y.w = y.v), y.v = Di[y.v];
								break;
						}
						if (T = E = 0, D = -1, k = null, O && b.s !== void 0 && (D = parseInt(b.s, 10), k = l.CellXf[D], k != null && (k.numFmtId != null && (T = k.numFmtId), o.cellStyles && k.fillId != null && (E = k.fillId))), of(y, T, E, o, c, l, I, k, D), o.cellDates && O && y.t == "n" && ze(V[T]) && (y.v = lt(y.v + (I ? 1462 : 0)), y.t = typeof y.v == "number" ? "n" : "d"), b.cm && o.xlmeta) {
							var ae = (o.xlmeta.Cell || [])[b.cm - 1];
							ae && ae.type == "XLDAPR" && (y.D = !0);
						}
						var oe;
						o.nodim && (oe = jr(b.r), s.s.r > oe.r && (s.s.r = oe.r), s.e.r < oe.r && (s.e.r = oe.r)), ee ? (oe = jr(b.r), a["!data"][oe.r] || (a["!data"][oe.r] = []), a["!data"][oe.r][oe.c] = y) : a[b.r] = y;
					}
				}
			}
		}
		M.length > 0 && (a["!rows"] = M);
	};
})();
function Df(e, t) {
	var n = {}, r = e.l + t;
	n.r = e.read_shift(4), e.l += 4;
	var i = e.read_shift(2);
	e.l += 1;
	var a = e.read_shift(1);
	return e.l = r, a & 7 && (n.level = a & 7), a & 16 && (n.hidden = !0), a & 32 && (n.hpt = i / 20), n;
}
var Of = ei;
function kf() {}
function Af(e, t) {
	var n = {}, r = e[e.l];
	return ++e.l, n.above = !(r & 64), n.left = !(r & 128), e.l += 18, n.name = Jr(e, t - 19), n;
}
function jf(e) {
	return [Kr(e)];
}
function Mf(e) {
	return [qr(e)];
}
function Nf(e) {
	return [
		Kr(e),
		e.read_shift(1),
		"b"
	];
}
function Pf(e) {
	return [
		qr(e),
		e.read_shift(1),
		"b"
	];
}
function Ff(e) {
	return [
		Kr(e),
		e.read_shift(1),
		"e"
	];
}
function If(e) {
	return [
		qr(e),
		e.read_shift(1),
		"e"
	];
}
function Lf(e) {
	return [
		Kr(e),
		e.read_shift(4),
		"s"
	];
}
function Rf(e) {
	return [
		qr(e),
		e.read_shift(4),
		"s"
	];
}
function zf(e) {
	return [
		Kr(e),
		ti(e),
		"n"
	];
}
function Bf(e) {
	return [
		qr(e),
		ti(e),
		"n"
	];
}
function Vf(e) {
	return [
		Kr(e),
		Qr(e),
		"n"
	];
}
function Hf(e) {
	return [
		qr(e),
		Qr(e),
		"n"
	];
}
function Uf(e) {
	return [
		Kr(e),
		Wr(e),
		"is"
	];
}
function Wf(e) {
	return [
		Kr(e),
		Hr(e),
		"str"
	];
}
function Gf(e) {
	return [
		qr(e),
		Hr(e),
		"str"
	];
}
function Kf(e, t, n) {
	var r = e.l + t, i = Kr(e);
	i.r = n["!row"];
	var a = [
		i,
		e.read_shift(1),
		"b"
	];
	return n.cellFormula ? (e.l += 2, a[3] = Id(Gd(e, r - e.l, n), null, i, n.supbooks, n)) : e.l = r, a;
}
function qf(e, t, n) {
	var r = e.l + t, i = Kr(e);
	i.r = n["!row"];
	var a = [
		i,
		e.read_shift(1),
		"e"
	];
	return n.cellFormula ? (e.l += 2, a[3] = Id(Gd(e, r - e.l, n), null, i, n.supbooks, n)) : e.l = r, a;
}
function Jf(e, t, n) {
	var r = e.l + t, i = Kr(e);
	i.r = n["!row"];
	var a = [
		i,
		ti(e),
		"n"
	];
	return n.cellFormula ? (e.l += 2, a[3] = Id(Gd(e, r - e.l, n), null, i, n.supbooks, n)) : e.l = r, a;
}
function Yf(e, t, n) {
	var r = e.l + t, i = Kr(e);
	i.r = n["!row"];
	var a = [
		i,
		Hr(e),
		"str"
	];
	return n.cellFormula ? (e.l += 2, a[3] = Id(Gd(e, r - e.l, n), null, i, n.supbooks, n)) : e.l = r, a;
}
var Xf = ei;
function Zf(e, t) {
	var n = e.l + t, r = ei(e, 16), i = Yr(e), a = Hr(e), o = Hr(e), s = Hr(e);
	e.l = n;
	var c = {
		rfx: r,
		relId: i,
		loc: a,
		display: s
	};
	return o && (c.Tooltip = o), c;
}
function Qf() {}
function $f(e, t, n) {
	var r = e.l + t, i = $r(e, 16), a = e.read_shift(1), o = [i];
	return o[2] = a, n.cellFormula ? o[1] = Wd(e, r - e.l, n) : e.l = r, o;
}
function ep(e, t, n) {
	var r = e.l + t, i = [ei(e, 16)];
	return n.cellFormula && (i[1] = qd(e, r - e.l, n)), e.l = r, i;
}
var tp = [
	"left",
	"right",
	"top",
	"bottom",
	"header",
	"footer"
];
function np(e) {
	var t = {};
	return tp.forEach(function(n) {
		t[n] = ti(e, 8);
	}), t;
}
function rp(e) {
	var t = e.read_shift(2);
	return e.l += 28, { RTL: t & 32 };
}
function ip() {}
function ap() {}
function op(e, t, n, r, i, a, o) {
	if (!e) return e;
	var s = t || {};
	r || (r = { "!id": {} }), _ != null && s.dense == null && (s.dense = _);
	var c = {};
	s.dense && (c["!data"] = []);
	var l, u = {
		s: {
			r: 2e6,
			c: 2e6
		},
		e: {
			r: 0,
			c: 0
		}
	}, d = [], f = !1, p = !1, m, h, g, v, y, b, x, S, C, w = [];
	s.biff = 12, s["!row"] = 0;
	var T = 0, E = !1, D = [], O = {}, k = s.supbooks || i.supbooks || [[]];
	if (k.sharedf = O, k.arrayf = D, k.SheetNames = i.SheetNames || i.Sheets.map(function(e) {
		return e.name;
	}), !s.supbooks && (s.supbooks = k, i.Names)) for (var A = 0; A < i.Names.length; ++A) k[0][A + 1] = i.Names[A];
	var j = [], ee = [], M = !1;
	jm[16] = {
		n: "BrtShortReal",
		f: Bf
	};
	var N, P, F = 1462 * !!((i || {}).WBProps || {}).date1904;
	if (gr(e, function(e, t, _) {
		if (!p) switch (_) {
			case 148:
				l = e;
				break;
			case 0:
				m = e, s.sheetRows && s.sheetRows <= m.r && (p = !0), S = Cr(v = m.r), s["!row"] = m.r, (e.hidden || e.hpt || e.level != null) && (e.hpt && (e.hpx = Ic(e.hpt)), ee[e.r] = e);
				break;
			case 2:
			case 3:
			case 4:
			case 5:
			case 6:
			case 7:
			case 8:
			case 9:
			case 10:
			case 11:
			case 13:
			case 14:
			case 15:
			case 16:
			case 17:
			case 18:
			case 62:
				switch (h = { t: e[2] }, e[2]) {
					case "n":
						h.v = e[1];
						break;
					case "s":
						x = $d[e[1]], h.v = x.t, h.r = x.r;
						break;
					case "b":
						h.v = !!e[1];
						break;
					case "e":
						h.v = e[1], s.cellText !== !1 && (h.w = Ei[h.v]);
						break;
					case "str":
						h.t = "s", h.v = e[1];
						break;
					case "is":
						h.t = "s", h.v = e[1].t;
						break;
				}
				if ((g = o.CellXf[e[0].iStyleRef]) && of(h, g.numFmtId, null, s, a, o, F > 0, g, e[0].iStyleRef), y = e[0].c == -1 ? y + 1 : e[0].c, s.dense ? (c["!data"][v] || (c["!data"][v] = []), c["!data"][v][y] = h) : c[Dr(y) + S] = h, s.cellFormula) {
					for (E = !1, T = 0; T < D.length; ++T) {
						var A = D[T];
						m.r >= A[0].s.r && m.r <= A[0].e.r && y >= A[0].s.c && y <= A[0].e.c && (h.F = X(A[0]), E = !0);
					}
					!E && e.length > 3 && (h.f = e[3]);
				}
				if (u.s.r > m.r && (u.s.r = m.r), u.s.c > y && (u.s.c = y), u.e.r < m.r && (u.e.r = m.r), u.e.c < y && (u.e.c = y), s.cellDates && g && h.t == "n" && ze(V[g.numFmtId])) {
					var I = H(h.v + F);
					I && (h.t = "d", h.v = new Date(Date.UTC(I.y, I.m - 1, I.d, I.H, I.M, I.S, I.u)));
				}
				N && (N.type == "XLDAPR" && (h.D = !0), N = void 0), P && (P = void 0);
				break;
			case 1:
			case 12:
				if (!s.sheetStubs || f) break;
				h = {
					t: "z",
					v: void 0
				}, y = e[0].c == -1 ? y + 1 : e[0].c, s.dense ? (c["!data"][v] || (c["!data"][v] = []), c["!data"][v][y] = h) : c[Dr(y) + S] = h, u.s.r > m.r && (u.s.r = m.r), u.s.c > y && (u.s.c = y), u.e.r < m.r && (u.e.r = m.r), u.e.c < y && (u.e.c = y), N && (N.type == "XLDAPR" && (h.D = !0), N = void 0), P && (P = void 0);
				break;
			case 176:
				w.push(e);
				break;
			case 49:
				N = ((s.xlmeta || {}).Cell || [])[e - 1];
				break;
			case 494:
				var L = r["!id"][e.relId];
				for (L ? (e.Target = L.Target, e.loc && (e.Target += "#" + e.loc), e.Rel = L) : e.relId == "" && (e.Target = "#" + e.loc), v = e.rfx.s.r; v <= e.rfx.e.r; ++v) for (y = e.rfx.s.c; y <= e.rfx.e.c; ++y) s.dense ? (c["!data"][v] || (c["!data"][v] = []), c["!data"][v][y] || (c["!data"][v][y] = {
					t: "z",
					v: void 0
				}), c["!data"][v][y].l = e) : (b = Dr(y) + Cr(v), c[b] || (c[b] = {
					t: "z",
					v: void 0
				}), c[b].l = e);
				break;
			case 426:
				if (!s.cellFormula) break;
				D.push(e), C = s.dense ? c["!data"][v][y] : c[Dr(y) + S], C.f = Id(e[1], u, {
					r: m.r,
					c: y
				}, k, s), C.F = X(e[0]);
				break;
			case 427:
				if (!s.cellFormula) break;
				O[Y(e[0].s)] = e[1], C = s.dense ? c["!data"][v][y] : c[Dr(y) + S], C.f = Id(e[1], u, {
					r: m.r,
					c: y
				}, k, s);
				break;
			case 60:
				if (!s.cellStyles) break;
				for (; e.e >= e.s;) j[e.e--] = {
					width: e.w / 256,
					hidden: !!(e.flags & 1),
					level: e.level
				}, M || (M = !0, pc(e.w / 256)), mc(j[e.e + 1]);
				break;
			case 551:
				e && (c["!legrel"] = e);
				break;
			case 161:
				c["!autofilter"] = { ref: X(e) };
				break;
			case 476:
				c["!margins"] = e;
				break;
			case 147:
				i.Sheets[n] || (i.Sheets[n] = {}), e.name && (i.Sheets[n].CodeName = e.name), (e.above || e.left) && (c["!outline"] = {
					above: e.above,
					left: e.left
				});
				break;
			case 137:
				i.Views || (i.Views = [{}]), i.Views[0] || (i.Views[0] = {}), e.RTL && (i.Views[0].RTL = !0);
				break;
			case 485: break;
			case 64:
			case 1053: break;
			case 151: break;
			case 152:
			case 175:
			case 644:
			case 625:
			case 562:
			case 396:
			case 1112:
			case 1146:
			case 471:
			case 1050:
			case 649:
			case 1105:
			case 589:
			case 607:
			case 564:
			case 1055:
			case 168:
			case 174:
			case 1180:
			case 499:
			case 507:
			case 550:
			case 171:
			case 167:
			case 1177:
			case 169:
			case 1181:
			case 552:
			case 661:
			case 639:
			case 478:
			case 537:
			case 477:
			case 536:
			case 1103:
			case 680:
			case 1104:
			case 1024:
			case 663:
			case 535:
			case 678:
			case 504:
			case 1043:
			case 428:
			case 170:
			case 3072:
			case 50:
			case 2070:
			case 1045: break;
			case 35:
				f = !0;
				break;
			case 36:
				f = !1;
				break;
			case 37:
				d.push(_), f = !0;
				break;
			case 38:
				d.pop(), f = !1;
				break;
			default: if (!t.T && (!f || s.WTF)) throw Error("Unexpected record 0x" + _.toString(16));
		}
	}, s), delete s.supbooks, delete s["!row"], !c["!ref"] && (u.s.r < 2e6 || l && (l.e.r > 0 || l.e.c > 0 || l.s.r > 0 || l.s.c > 0)) && (c["!ref"] = X(l || u)), s.sheetRows && c["!ref"]) {
		var I = Pr(c["!ref"]);
		s.sheetRows <= +I.e.r && (I.e.r = s.sheetRows - 1, I.e.r > u.e.r && (I.e.r = u.e.r), I.e.r < I.s.r && (I.s.r = I.e.r), I.e.c > u.e.c && (I.e.c = u.e.c), I.e.c < I.s.c && (I.s.c = I.e.c), c["!fullref"] = c["!ref"], c["!ref"] = X(I));
	}
	return w.length > 0 && (c["!merges"] = w), j.length > 0 && (c["!cols"] = j), ee.length > 0 && (c["!rows"] = ee), r["!id"][c["!legrel"]] && (c["!legdrawel"] = r["!id"][c["!legrel"]]), c;
}
function sp(e) {
	var t = [], n = e.match(/^<c:numCache>/), r;
	(e.match(/<c:pt idx="(\d*)"[^<>\/]*><c:v>([^<]*)<\/c:v><\/c:pt>/gm) || []).forEach(function(e) {
		var r = e.match(/<c:pt idx="(\d*)"[^<>\/]*><c:v>([^<]*)<\/c:v><\/c:pt>/);
		r && (t[+r[1]] = n ? +r[2] : r[2]);
	});
	var i = q((Pt(e, "c:formatCode") || ["", "General"])[1]);
	return (jt(e, "<c:f>", "</c:f>") || []).forEach(function(e) {
		r = e.replace(/<[^<>]*>/g, "");
	}), [
		t,
		i,
		r
	];
}
function cp(e) {
	var t = jt(e, "<c:numCache>", "</c:numCache>");
	if (t && t.length) {
		var n = sp(t[0]);
		return {
			values: n[0],
			formatCode: n[1],
			formula: n[2]
		};
	}
	var r = jt(e, "<c:strCache>", "</c:strCache>");
	if (r && r.length) {
		var i = sp(r[0]);
		return {
			values: i[0],
			formatCode: i[1],
			formula: i[2]
		};
	}
	var a = (jt(e, "<c:f>", "</c:f>") || [])[0];
	return {
		values: [],
		formula: a ? a.replace(/<[^<>]*>/g, "") : void 0
	};
}
function lp(e) {
	var t = jt(e, "<c:tx>", "</c:tx>");
	if (!t || !t.length) return "";
	var n = Ft(t[0], "v");
	if (n && n[1]) return q(n[1]);
	var r = Ft(t[0], "f");
	return r && r[1] ? q(r[1]) : "";
}
function up(e) {
	var t = { name: lp(e) }, n = Ft(e, "idx");
	n && (t.idx = +(K(n[0]).val || 0));
	var r = Ft(e, "order");
	return r && (t.order = +(K(r[0]).val || 0)), [
		"cat",
		"val",
		"xVal",
		"yVal",
		"bubbleSize"
	].forEach(function(n) {
		var r = Ft(e, n);
		r && (t[n] = cp(r[0]));
	}), t.val && t.val.values ? t.data = t.val.values : t.yVal && t.yVal.values && (t.data = t.yVal.values), t;
}
function dp(e) {
	var t = Ft(e, "title");
	if (!t) return "";
	var n = [];
	return (t[0].match(/<a:t\b[^>]*>[\s\S]*?<\/a:t>/g) || []).forEach(function(e) {
		n.push(q(e.replace(/<[^>]*>/g, "")));
	}), n.join("");
}
function fp(e, t, n) {
	var r = {
		target: t,
		raw: e,
		rels: n,
		series: []
	};
	r.title = dp(e);
	var i = Ft(e, "plotArea"), a = i ? i[1] : e;
	[
		"barChart",
		"lineChart",
		"areaChart",
		"scatterChart",
		"pieChart",
		"doughnutChart",
		"bubbleChart"
	].forEach(function(e) {
		(jt(a, "<c:" + e + ">", "</c:" + e + ">") || []).forEach(function(t) {
			r.type || (r.type = e);
			var n = Ft(t, "grouping");
			n && (r.grouping = K(n[0]).val), (jt(t, "<c:ser>", "</c:ser>") || []).forEach(function(t) {
				var n = up(t);
				n.chartType = e, r.series.push(n);
			});
		});
	});
	var o = Ft(e, "legend");
	if (o) {
		r.legend = {};
		var s = Ft(o[0], "legendPos");
		s && (r.legend.position = K(s[0]).val);
	}
	return r;
}
function pp(e, t, n, r, i, a) {
	var o = a || { "!type": "chart" };
	if (!e) return a;
	o["!chart"] = fp(e, t, r);
	var s = 0, c = 0, l = "A", u = {
		s: {
			r: 2e6,
			c: 2e6
		},
		e: {
			r: 0,
			c: 0
		}
	};
	return (jt(e, "<c:numCache>", "</c:numCache>") || []).forEach(function(e) {
		var t = sp(e);
		u.s.r = u.s.c = 0, u.e.c = s, l = Dr(s), t[0].forEach(function(e, n) {
			o["!data"] ? (o["!data"][n] || (o["!data"][n] = []), o["!data"][n][s] = {
				t: "n",
				v: e,
				z: t[1]
			}) : o[l + Cr(n)] = {
				t: "n",
				v: e,
				z: t[1]
			}, c = n;
		}), u.e.r < c && (u.e.r = c), ++s;
	}), s > 0 && (o["!ref"] = X(u)), o;
}
function mp(e, t, n, r, i) {
	if (!e) return e;
	r || (r = { "!id": {} });
	var a = {
		"!type": "chart",
		"!drawel": null,
		"!rel": ""
	}, o, s = e.match(gf);
	return s && vf(s[0], a, i, n), (o = e.match(/drawing r:id="(.*?)"/)) && (a["!rel"] = o[1]), r["!id"][a["!rel"]] && (a["!drawel"] = r["!id"][a["!rel"]]), a;
}
function hp(e, t) {
	return e.l += 10, { name: Hr(e, t - 10) };
}
function gp(e, t, n, r, i) {
	if (!e) return e;
	r || (r = { "!id": {} });
	var a = {
		"!type": "chart",
		"!drawel": null,
		"!rel": ""
	}, o = [], s = !1;
	return gr(e, function(e, r, c) {
		switch (c) {
			case 550:
				a["!rel"] = e;
				break;
			case 651:
				i.Sheets[n] || (i.Sheets[n] = {}), e.name && (i.Sheets[n].CodeName = e.name);
				break;
			case 562:
			case 652:
			case 669:
			case 679:
			case 551:
			case 552:
			case 476:
			case 3072: break;
			case 35:
				s = !0;
				break;
			case 36:
				s = !1;
				break;
			case 37:
				o.push(c);
				break;
			case 38:
				o.pop();
				break;
			default: if (r.T > 0) o.push(c);
			else if (r.T < 0) o.pop();
			else if (!s || t.WTF) throw Error("Unexpected record 0x" + c.toString(16));
		}
	}, t), r["!id"][a["!rel"]] && (a["!drawel"] = r["!id"][a["!rel"]]), a;
}
var _p = [
	[
		"allowRefreshQuery",
		!1,
		"bool"
	],
	[
		"autoCompressPictures",
		!0,
		"bool"
	],
	[
		"backupFile",
		!1,
		"bool"
	],
	[
		"checkCompatibility",
		!1,
		"bool"
	],
	["CodeName", ""],
	[
		"date1904",
		!1,
		"bool"
	],
	[
		"defaultThemeVersion",
		0,
		"int"
	],
	[
		"filterPrivacy",
		!1,
		"bool"
	],
	[
		"hidePivotFieldList",
		!1,
		"bool"
	],
	[
		"promptedSolutions",
		!1,
		"bool"
	],
	[
		"publishItems",
		!1,
		"bool"
	],
	[
		"refreshAllConnections",
		!1,
		"bool"
	],
	[
		"saveExternalLinkValues",
		!0,
		"bool"
	],
	[
		"showBorderUnselectedTables",
		!0,
		"bool"
	],
	[
		"showInkAnnotation",
		!0,
		"bool"
	],
	["showObjects", "all"],
	[
		"showPivotChartFilter",
		!1,
		"bool"
	],
	["updateLinks", "userSet"]
], vp = [
	[
		"activeTab",
		0,
		"int"
	],
	[
		"autoFilterDateGrouping",
		!0,
		"bool"
	],
	[
		"firstSheet",
		0,
		"int"
	],
	[
		"minimized",
		!1,
		"bool"
	],
	[
		"showHorizontalScroll",
		!0,
		"bool"
	],
	[
		"showSheetTabs",
		!0,
		"bool"
	],
	[
		"showVerticalScroll",
		!0,
		"bool"
	],
	[
		"tabRatio",
		600,
		"int"
	],
	["visibility", "visible"]
], yp = [], bp = [
	["calcCompleted", "true"],
	["calcMode", "auto"],
	["calcOnSave", "true"],
	["concurrentCalc", "true"],
	["fullCalcOnLoad", "false"],
	["fullPrecision", "true"],
	["iterate", "false"],
	["iterateCount", "100"],
	["iterateDelta", "0.001"],
	["refMode", "A1"]
];
function xp(e, t) {
	for (var n = 0; n != e.length; ++n) for (var r = e[n], i = 0; i != t.length; ++i) {
		var a = t[i];
		if (r[a[0]] == null) r[a[0]] = a[1];
		else switch (a[2]) {
			case "bool":
				typeof r[a[0]] == "string" && (r[a[0]] = J(r[a[0]]));
				break;
			case "int":
				typeof r[a[0]] == "string" && (r[a[0]] = parseInt(r[a[0]], 10));
				break;
		}
	}
}
function Sp(e, t) {
	for (var n = 0; n != t.length; ++n) {
		var r = t[n];
		if (e[r[0]] == null) e[r[0]] = r[1];
		else switch (r[2]) {
			case "bool":
				typeof e[r[0]] == "string" && (e[r[0]] = J(e[r[0]]));
				break;
			case "int":
				typeof e[r[0]] == "string" && (e[r[0]] = parseInt(e[r[0]], 10));
				break;
		}
	}
}
function Cp(e) {
	Sp(e.WBProps, _p), Sp(e.CalcPr, bp), xp(e.WBView, vp), xp(e.Sheets, yp), ef.date1904 = J(e.WBProps.date1904);
}
var wp = /*#__PURE__*/ ":][*?/\\".split("");
function Tp(e, t) {
	try {
		if (e == "") throw Error("Sheet name cannot be blank");
		if (e.length > 31) throw Error("Sheet name cannot exceed 31 chars");
		if (e.charCodeAt(0) == 39 || e.charCodeAt(e.length - 1) == 39) throw Error("Sheet name cannot start or end with apostrophe (')");
		if (e.toLowerCase() == "history") throw Error("Sheet name cannot be 'History'");
		wp.forEach(function(t) {
			if (e.indexOf(t) != -1) throw Error("Sheet name cannot contain : \\ / ? * [ ]");
		});
	} catch (e) {
		if (t) return !1;
		throw e;
	}
	return !0;
}
var Ep = /<\w+:workbook/;
function Dp(e, t) {
	if (!e) throw Error("Could not find file");
	var n = {
		AppVersion: {},
		WBProps: {},
		WBView: [],
		Sheets: [],
		CalcPr: {},
		Names: [],
		xmlns: ""
	}, r = !1, i = "xmlns", a = {}, o = 0;
	if (e.replace(en, function(s, c) {
		var l = K(s);
		switch (an(l[0])) {
			case "<?xml": break;
			case "<workbook":
				s.match(Ep) && (i = "xmlns" + s.match(/<(\w+):/)[1]), n.xmlns = l[i];
				break;
			case "</workbook>": break;
			case "<fileVersion":
				delete l[0], n.AppVersion = l;
				break;
			case "<fileVersion/>":
			case "</fileVersion>": break;
			case "<fileSharing": break;
			case "<fileSharing/>": break;
			case "<workbookPr":
			case "<workbookPr/>":
				_p.forEach(function(e) {
					if (l[e[0]] != null) switch (e[2]) {
						case "bool":
							n.WBProps[e[0]] = J(l[e[0]]);
							break;
						case "int":
							n.WBProps[e[0]] = parseInt(l[e[0]], 10);
							break;
						default: n.WBProps[e[0]] = l[e[0]];
					}
				}), l.codeName && (n.WBProps.CodeName = vn(l.codeName));
				break;
			case "</workbookPr>": break;
			case "<workbookProtection": break;
			case "<workbookProtection/>": break;
			case "<bookViews":
			case "<bookViews>":
			case "</bookViews>": break;
			case "<workbookView":
			case "<workbookView/>":
				delete l[0], n.WBView.push(l);
				break;
			case "</workbookView>": break;
			case "<sheets":
			case "<sheets>":
			case "</sheets>": break;
			case "<sheet":
				switch (l.state) {
					case "hidden":
						l.Hidden = 1;
						break;
					case "veryHidden":
						l.Hidden = 2;
						break;
					default: l.Hidden = 0;
				}
				delete l.state, l.name = q(vn(l.name)), delete l[0], n.Sheets.push(l);
				break;
			case "</sheet>": break;
			case "<functionGroups":
			case "<functionGroups/>": break;
			case "<functionGroup": break;
			case "<externalReferences":
			case "</externalReferences>":
			case "<externalReferences>": break;
			case "<externalReference": break;
			case "<definedNames/>": break;
			case "<definedNames>":
			case "<definedNames":
				r = !0;
				break;
			case "</definedNames>":
				r = !1;
				break;
			case "<definedName":
				a = {}, a.Name = vn(l.name), l.comment && (a.Comment = l.comment), l.localSheetId && (a.Sheet = +l.localSheetId), J(l.hidden || "0") && (a.Hidden = !0), o = c + s.length;
				break;
			case "</definedName>":
				a.Ref = q(vn(e.slice(o, c))), n.Names.push(a);
				break;
			case "<definedName/>": break;
			case "<calcPr":
				delete l[0], n.CalcPr = l;
				break;
			case "<calcPr/>":
				delete l[0], n.CalcPr = l;
				break;
			case "</calcPr>": break;
			case "<oleSize": break;
			case "<customWorkbookViews>":
			case "</customWorkbookViews>":
			case "<customWorkbookViews": break;
			case "<customWorkbookView":
			case "</customWorkbookView>": break;
			case "<pivotCaches>":
			case "</pivotCaches>":
			case "<pivotCaches": break;
			case "<pivotCache": break;
			case "<smartTagPr":
			case "<smartTagPr/>": break;
			case "<smartTagTypes":
			case "<smartTagTypes>":
			case "</smartTagTypes>": break;
			case "<smartTagType": break;
			case "<webPublishing":
			case "<webPublishing/>": break;
			case "<fileRecoveryPr":
			case "<fileRecoveryPr/>": break;
			case "<webPublishObjects>":
			case "<webPublishObjects":
			case "</webPublishObjects>": break;
			case "<webPublishObject": break;
			case "<extLst":
			case "<extLst>":
			case "</extLst>":
			case "<extLst/>": break;
			case "<ext":
				r = !0;
				break;
			case "</ext>":
				r = !1;
				break;
			case "<ArchID": break;
			case "<AlternateContent":
			case "<AlternateContent>":
				r = !0;
				break;
			case "</AlternateContent>":
				r = !1;
				break;
			case "<revisionPtr": break;
			default: if (!r && t.WTF) throw Error("unrecognized " + l[0] + " in workbook");
		}
		return s;
	}), An.indexOf(n.xmlns) === -1) throw Error("Unknown Namespace: " + n.xmlns);
	return Cp(n), n;
}
function Op(e, t) {
	var n = {};
	return n.Hidden = e.read_shift(4), n.iTabID = e.read_shift(4), n.strRelID = Zr(e, t - 8), n.name = Hr(e), n;
}
function kp(e, t) {
	var n = {}, r = e.read_shift(4);
	n.defaultThemeVersion = e.read_shift(4);
	var i = t > 8 ? Hr(e) : "";
	return i.length > 0 && (n.CodeName = i), n.autoCompressPictures = !!(r & 65536), n.backupFile = !!(r & 64), n.checkCompatibility = !!(r & 4096), n.date1904 = !!(r & 1), n.filterPrivacy = !!(r & 8), n.hidePivotFieldList = !!(r & 1024), n.promptedSolutions = !!(r & 16), n.publishItems = !!(r & 2048), n.refreshAllConnections = !!(r & 262144), n.saveExternalLinkValues = !!(r & 128), n.showBorderUnselectedTables = !!(r & 4), n.showInkAnnotation = !!(r & 32), n.showObjects = [
		"all",
		"placeholders",
		"none"
	][r >> 13 & 3], n.showPivotChartFilter = !!(r & 32768), n.updateLinks = [
		"userSet",
		"never",
		"always"
	][r >> 8 & 3], n;
}
function Ap(e, t) {
	var n = {};
	return e.read_shift(4), n.ArchID = e.read_shift(4), e.l += t - 8, n;
}
function jp(e, t, n) {
	var r = e.l + t, i = e.read_shift(4);
	e.l += 1;
	var a = e.read_shift(4), o = Xr(e), s, c = "";
	try {
		s = Kd(e, 0, n);
		try {
			c = Yr(e);
		} catch {}
	} catch {
		console.error("Could not parse defined name " + o);
	}
	i & 32 && (o = "_xlnm." + o), e.l = r;
	var l = {
		Name: o,
		Ptg: s,
		Flags: i
	};
	return a < 268435455 && (l.Sheet = a), c && (l.Comment = c), l;
}
function Mp(e, t) {
	var n = {
		AppVersion: {},
		WBProps: {},
		WBView: [],
		Sheets: [],
		CalcPr: {},
		xmlns: ""
	}, r = [], i = !1;
	t || (t = {}), t.biff = 12;
	var a = [], o = [[]];
	return o.SheetNames = [], o.XTI = [], jm[16] = {
		n: "BrtFRTArchID$",
		f: Ap
	}, gr(e, function(e, s, c) {
		switch (c) {
			case 156:
				o.SheetNames.push(e.name), n.Sheets.push(e);
				break;
			case 153:
				n.WBProps = e;
				break;
			case 39:
				e.Sheet != null && (t.SID = e.Sheet), e.Ref = e.Ptg ? Id(e.Ptg, null, null, o, t) : "#REF!", delete t.SID, delete e.Ptg, a.push(e);
				break;
			case 1036: break;
			case 357:
			case 358:
			case 355:
			case 667:
				o[0].length ? o.push([c, e]) : o[0] = [c, e], o[o.length - 1].XTI = [];
				break;
			case 362:
				o.length === 0 && (o[0] = [], o[0].XTI = []), o[o.length - 1].XTI = o[o.length - 1].XTI.concat(e), o.XTI = o.XTI.concat(e);
				break;
			case 361: break;
			case 2071:
			case 158:
			case 143:
			case 664:
			case 353: break;
			case 3072:
			case 3073:
			case 534:
			case 677:
			case 157:
			case 610:
			case 2050:
			case 155:
			case 548:
			case 676:
			case 128:
			case 665:
			case 2128:
			case 2125:
			case 549:
			case 2053:
			case 596:
			case 2076:
			case 2075:
			case 2082:
			case 397:
			case 154:
			case 1117:
			case 553:
			case 2091: break;
			case 35:
				r.push(c), i = !0;
				break;
			case 36:
				r.pop(), i = !1;
				break;
			case 37:
				r.push(c), i = !0;
				break;
			case 38:
				r.pop(), i = !1;
				break;
			case 16: break;
			default: if (!s.T && (!i || t.WTF && r[r.length - 1] != 37 && r[r.length - 1] != 35)) throw Error("Unexpected record 0x" + c.toString(16));
		}
	}, t), Cp(n), n.Names = a, n.supbooks = o, n;
}
function Np(e, t, n) {
	return t.slice(-4) === ".bin" ? Mp(e, n) : Dp(e, n);
}
function Pp(e, t, n, r, i, a, o, s) {
	return t.slice(-4) === ".bin" ? op(e, r, n, i, a, o, s) : _f(e, r, n, i, a, o, s);
}
function Fp(e, t, n, r, i, a, o, s) {
	return t.slice(-4) === ".bin" ? gp(e, r, n, i, a, o, s) : mp(e, r, n, i, a, o, s);
}
function Ip(e, t, n, r, i, a, o, s) {
	return t.slice(-4) === ".bin" ? $l(e, r, n, i, a, o, s) : eu(e, r, n, i, a, o, s);
}
function Lp(e, t, n, r, i, a, o, s) {
	return t.slice(-4) === ".bin" ? Zl(e, r, n, i, a, o, s) : Ql(e, r, n, i, a, o, s);
}
function Rp(e, t, n, r) {
	return t.slice(-4) === ".bin" ? il(e, n, r) : Qc(e, n, r);
}
function zp(e, t, n) {
	return t.slice(-4) === ".bin" ? ws(e, n) : Ss(e, n);
}
function Bp(e, t, n) {
	return t.slice(-4) === ".bin" ? Jl(e, n) : Ul(e, n);
}
function Vp(e, t, n) {
	return t.slice(-4) === ".bin" ? Tl(e, t, n) : Cl(e, t, n);
}
function Hp(e, t, n, r) {
	if (n.slice(-4) === ".bin") return El(e, t, n, r);
}
function Up(e, t, n) {
	return t.slice(-4) === ".bin" ? xl(e, t, n) : Sl(e, t, n);
}
var Wp = /\b((?:\w+:)?[\w]+)=((?:")([^"]*)(?:")|(?:')([^']*)(?:'))/g, Gp = /\b((?:\w+:)?[\w]+)=((?:")(?:[^"]*)(?:")|(?:')(?:[^']*)(?:'))/;
function Kp(e, t) {
	var n = e.split(/\s+/), r = [];
	if (t || (r[0] = n[0]), n.length === 1) return r;
	var i = e.match(Wp), a, o, s, c;
	if (i) for (c = 0; c != i.length; ++c) a = i[c].match(Gp), (o = a[1].indexOf(":")) === -1 ? r[a[1]] = a[2].slice(1, a[2].length - 1) : (s = a[1].slice(0, 6) === "xmlns:" ? "xmlns" + a[1].slice(6) : a[1].slice(o + 1), r[s] = a[2].slice(1, a[2].length - 1));
	return r;
}
function qp(e) {
	var t = e.split(/\s+/), n = {};
	if (t.length === 1) return n;
	var r = e.match(Wp), i, a, o, s;
	if (r) for (s = 0; s != r.length; ++s) i = r[s].match(Gp), (a = i[1].indexOf(":")) === -1 ? n[i[1]] = i[2].slice(1, i[2].length - 1) : (o = i[1].slice(0, 6) === "xmlns:" ? "xmlns" + i[1].slice(6) : i[1].slice(a + 1), n[o] = i[2].slice(1, i[2].length - 1));
	return n;
}
var Jp;
function Yp(e, t, n) {
	var r = Jp[e] || q(e);
	return r === "General" ? pe(t) : We(r, t, { date1904: !!n });
}
function Xp(e, t, n, r) {
	var i = r;
	switch ((n[0].match(/dt:dt="([\w.]+)"/) || ["", ""])[1]) {
		case "boolean":
			i = J(r);
			break;
		case "i2":
		case "int":
			i = parseInt(r, 10);
			break;
		case "r4":
		case "float":
			i = parseFloat(r);
			break;
		case "date":
		case "dateTime.tz":
			i = mt(r);
			break;
		case "i8":
		case "string":
		case "fixed":
		case "uuid":
		case "bin.base64": break;
		default: throw Error("bad custprop:" + n[0]);
	}
	e[q(t)] = i;
}
function Zp(e, t, n, r) {
	if (e.t !== "z") {
		if (!n || n.cellText !== !1) try {
			e.t === "e" ? e.w = e.w || Ei[e.v] : t === "General" ? e.t === "n" ? (e.v | 0) === e.v ? e.w = e.v.toString(10) : e.w = fe(e.v) : e.w = pe(e.v) : e.w = Yp(t || "General", e.v, r);
		} catch (e) {
			if (n.WTF) throw e;
		}
		try {
			var i = Jp[t] || t || "General";
			if (n.cellNF && (e.z = i), n.cellDates && e.t == "n" && ze(i)) {
				var a = H(e.v + (r ? 1462 : 0));
				a && (e.t = "d", e.v = new Date(Date.UTC(a.y, a.m - 1, a.d, a.H, a.M, a.S, a.u)));
			}
		} catch (e) {
			if (n.WTF) throw e;
		}
	}
}
function Qp(e, t, n) {
	if (n.cellStyles && t.Interior) {
		var r = t.Interior;
		r.Pattern && (r.patternType = zc[r.Pattern] || r.Pattern);
	}
	e[t.ID] = t;
}
function $p(e, t, n, r, i, a, o, s, c, l, u) {
	var d = "General", f = r.StyleID, p = {};
	l = l || {};
	var m = [], h = 0;
	for (f === void 0 && s && (f = s.StyleID), f === void 0 && o && (f = o.StyleID); a[f] !== void 0;) {
		var g = a[f];
		if (g.nf && (d = g.nf), g.Interior && m.push(g.Interior), !g.Parent) break;
		f = g.Parent;
	}
	switch (n.Type) {
		case "Boolean":
			r.t = "b", r.v = J(e);
			break;
		case "String":
			r.t = "s", r.r = pn(q(e)), r.v = e.indexOf("<") > -1 ? q(t || e).replace(/<[^<>]*>/g, "") : r.r;
			break;
		case "DateTime": e.slice(-1) != "Z" && (e += "Z"), r.v = ct(mt(e, u), u), r.v !== r.v && (r.v = q(e)), (!d || d == "General") && (d = "yyyy-mm-dd");
		case "Number":
			r.v === void 0 && (r.v = +e), r.t || (r.t = "n");
			break;
		case "Error":
			r.t = "e", r.v = Di[e], l.cellText !== !1 && (r.w = e);
			break;
		default:
			e == "" && t == "" ? r.t = "z" : (r.t = "s", r.v = pn(t || e));
			break;
	}
	if (Zp(r, d, l, u), l.cellFormula !== !1) if (r.Formula) {
		var _ = q(r.Formula);
		_.charCodeAt(0) == 61 && (_ = _.slice(1)), r.f = tu(_, i), delete r.Formula, r.ArrayRange == "RC" ? r.F = tu("RC:RC", i) : r.ArrayRange && (r.F = tu(r.ArrayRange, i), c.push([Pr(r.F), r.F]));
	} else for (h = 0; h < c.length; ++h) i.r >= c[h][0].s.r && i.r <= c[h][0].e.r && i.c >= c[h][0].s.c && i.c <= c[h][0].e.c && (r.F = c[h][1]);
	l.cellStyles && (m.forEach(function(e) {
		!p.patternType && e.patternType && (p.patternType = e.patternType);
	}), r.s = p), r.StyleID !== void 0 && (r.ixfe = r.StyleID);
}
function em(e) {
	return Oi.indexOf("_xlnm." + e) > -1 ? "_xlnm." + e : e;
}
function tm(e) {
	e.t = e.v || "", e.t = e.t.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), e.v = e.w = e.ixfe = void 0;
}
function nm(e, t) {
	var n = t || {};
	Ke();
	var i = m(Dn(e));
	(n.type == "binary" || n.type == "array" || n.type == "base64") && (i = r === void 0 ? vn(i) : r.utils.decode(65001, u(i)));
	var a = i.slice(0, 1024).toLowerCase(), o = !1;
	if (a = a.replace(/".*?"/g, ""), (a.indexOf(">") & 1023) > Math.min(a.indexOf(",") & 1023, a.indexOf(";") & 1023)) {
		var s = gt(n);
		return s.type = "string", us.to_workbook(i, s);
	}
	if (a.indexOf("<?xml") == -1 && [
		"html",
		"table",
		"head",
		"meta",
		"script",
		"style",
		"div"
	].forEach(function(e) {
		a.indexOf("<" + e) >= 0 && (o = !0);
	}), o) return Jm(i, n);
	Jp = {
		"General Number": "General",
		"General Date": V[22],
		"Long Date": "dddd, mmmm dd, yyyy",
		"Medium Date": V[15],
		"Short Date": V[14],
		"Long Time": V[19],
		"Medium Time": V[18],
		"Short Time": V[20],
		Currency: "\"$\"#,##0.00_);[Red]\\(\"$\"#,##0.00\\)",
		Fixed: V[2],
		Standard: V[4],
		Percent: V[10],
		Scientific: V[11],
		"Yes/No": "\"Yes\";\"Yes\";\"No\";@",
		"True/False": "\"True\";\"True\";\"False\";@",
		"On/Off": "\"Yes\";\"Yes\";\"No\";@"
	};
	var c, l = [], d;
	_ != null && n.dense == null && (n.dense = _);
	var f = {}, p = [], h = {}, g = "";
	n.dense && (h["!data"] = []);
	var v = {}, y = {}, b = Kp("<Data ss:Type=\"String\">"), x = 0, S = 0, C = 0, w = {
		s: {
			r: 2e6,
			c: 2e6
		},
		e: {
			r: 0,
			c: 0
		}
	}, T = {}, E = {}, D = "", O = 0, k = [], A = {}, j = {}, ee = 0, M = [], N = [], P = {}, F = [], I, L = !1, te = [], ne = [], re = {}, R = 0, z = 0, B = {
		Sheets: [],
		WBProps: { date1904: !1 }
	}, ie = {};
	On.lastIndex = 0, i = Mt(i, "<!--", "-->");
	for (var ae = ""; c = On.exec(i);) switch (c[3] = (ae = c[3]).toLowerCase()) {
		case "data":
			if (ae == "data") {
				if (c[1] === "/") {
					if ((d = l.pop())[0] !== c[3]) throw Error("Bad state: " + d.join("|"));
				} else c[0].charAt(c[0].length - 2) !== "/" && l.push([c[3], !0]);
				break;
			}
			if (l[l.length - 1][1]) break;
			c[1] === "/" ? $p(i.slice(x, c.index), D, b, l[l.length - 1][0] == "comment" ? P : v, {
				c: S,
				r: C
			}, T, F[S], y, te, n, B.WBProps.date1904) : (D = "", b = Kp(c[0]), x = c.index + c[0].length);
			break;
		case "cell":
			if (c[1] === "/") if (N.length > 0 && (v.c = N), (!n.sheetRows || n.sheetRows > C) && v.v !== void 0 && (n.dense ? (h["!data"][C] || (h["!data"][C] = []), h["!data"][C][S] = v) : h[Dr(S) + Cr(C)] = v), v.HRef && (v.l = { Target: q(v.HRef) }, v.HRefScreenTip && (v.l.Tooltip = v.HRefScreenTip), delete v.HRef, delete v.HRefScreenTip), (v.MergeAcross || v.MergeDown) && (R = S + (parseInt(v.MergeAcross, 10) | 0), z = C + (parseInt(v.MergeDown, 10) | 0), (R > S || z > C) && k.push({
				s: {
					c: S,
					r: C
				},
				e: {
					c: R,
					r: z
				}
			})), !n.sheetStubs) v.MergeAcross ? S = R + 1 : ++S;
			else if (v.MergeAcross || v.MergeDown) {
				for (var oe = S; oe <= R; ++oe) for (var se = C; se <= z; ++se) (oe > S || se > C) && (n.dense ? (h["!data"][se] || (h["!data"][se] = []), h["!data"][se][oe] = { t: "z" }) : h[Dr(oe) + Cr(se)] = { t: "z" });
				S = R + 1;
			} else ++S;
			else v = qp(c[0]), v.Index && (S = v.Index - 1), S < w.s.c && (w.s.c = S), S > w.e.c && (w.e.c = S), c[0].slice(-2) === "/>" && ++S, N = [];
			break;
		case "row":
			c[1] === "/" || c[0].slice(-2) === "/>" ? (C < w.s.r && (w.s.r = C), C > w.e.r && (w.e.r = C), c[0].slice(-2) === "/>" && (y = Kp(c[0]), y.Index && (C = y.Index - 1)), S = 0, ++C) : (y = Kp(c[0]), y.Index && (C = y.Index - 1), re = {}, (y.AutoFitHeight == "0" || y.Height) && (re.hpx = parseInt(y.Height, 10), re.hpt = Fc(re.hpx), ne[C] = re), y.Hidden == "1" && (re.hidden = !0, ne[C] = re));
			break;
		case "worksheet":
			if (c[1] === "/") {
				if ((d = l.pop())[0] !== c[3]) throw Error("Bad state: " + d.join("|"));
				p.push(g), w.s.r <= w.e.r && w.s.c <= w.e.c && (h["!ref"] = X(w), n.sheetRows && n.sheetRows <= w.e.r && (h["!fullref"] = h["!ref"], w.e.r = n.sheetRows - 1, h["!ref"] = X(w))), k.length && (h["!merges"] = k), F.length > 0 && (h["!cols"] = F), ne.length > 0 && (h["!rows"] = ne), f[g] = h;
			} else w = {
				s: {
					r: 2e6,
					c: 2e6
				},
				e: {
					r: 0,
					c: 0
				}
			}, C = S = 0, l.push([c[3], !1]), d = Kp(c[0]), g = q(d.Name), h = {}, n.dense && (h["!data"] = []), k = [], te = [], ne = [], ie = {
				name: g,
				Hidden: 0
			}, B.Sheets.push(ie);
			break;
		case "table":
			if (c[1] === "/") {
				if ((d = l.pop())[0] !== c[3]) throw Error("Bad state: " + d.join("|"));
			} else if (c[0].slice(-2) == "/>") break;
			else l.push([c[3], !1]), F = [], L = !1;
			break;
		case "style":
			c[1] === "/" ? Qp(T, E, n) : E = Kp(c[0]);
			break;
		case "numberformat":
			E.nf = q(Kp(c[0]).Format || "General"), Jp[E.nf] && (E.nf = Jp[E.nf]);
			for (var ce = 0; ce != 392 && V[ce] != E.nf; ++ce);
			if (ce == 392) {
				for (ce = 57; ce != 392; ++ce) if (V[ce] == null) {
					Qe(E.nf, ce);
					break;
				}
			}
			break;
		case "column":
			if (l[l.length - 1][0] !== "table" || c[1] === "/") break;
			if (I = Kp(c[0]), I.Hidden && (I.hidden = !0, delete I.Hidden), I.Width && (I.wpx = parseInt(I.Width, 10)), !L && I.wpx > 10) {
				L = !0, cc = ac;
				for (var le = 0; le < F.length; ++le) F[le] && mc(F[le]);
			}
			L && mc(I), F[I.Index - 1 || F.length] = I;
			for (var H = 0; H < +I.Span; ++H) F[F.length] = gt(I);
			break;
		case "namedrange":
			if (c[1] === "/") break;
			B.Names || (B.Names = []);
			var ue = K(c[0]), U = {
				Name: em(ue.Name),
				Ref: tu(ue.RefersTo.slice(1), {
					r: 0,
					c: 0
				})
			};
			B.Sheets.length > 0 && (U.Sheet = B.Sheets.length - 1), B.Names.push(U);
			break;
		case "namedcell": break;
		case "b": break;
		case "i": break;
		case "u": break;
		case "s": break;
		case "em": break;
		case "h2": break;
		case "h3": break;
		case "sub": break;
		case "sup": break;
		case "span": break;
		case "alignment": break;
		case "borders": break;
		case "border": break;
		case "font":
			if (c[0].slice(-2) === "/>") break;
			c[1] === "/" ? D += i.slice(O, c.index) : O = c.index + c[0].length;
			break;
		case "interior":
			if (!n.cellStyles) break;
			E.Interior = Kp(c[0]);
			break;
		case "protection": break;
		case "author":
		case "title":
		case "description":
		case "created":
		case "keywords":
		case "subject":
		case "category":
		case "company":
		case "lastauthor":
		case "lastsaved":
		case "lastprinted":
		case "version":
		case "revision":
		case "totaltime":
		case "hyperlinkbase":
		case "manager":
		case "contentstatus":
		case "identifier":
		case "language":
		case "appname":
			if (c[0].slice(-2) === "/>") break;
			c[1] === "/" ? Ki(A, ae, i.slice(ee, c.index)) : ee = c.index + c[0].length;
			break;
		case "paragraphs": break;
		case "styles":
		case "workbook":
			if (c[1] === "/") {
				if ((d = l.pop())[0] !== c[3]) throw Error("Bad state: " + d.join("|"));
			} else l.push([c[3], !1]);
			break;
		case "comment":
			if (c[1] === "/") {
				if ((d = l.pop())[0] !== c[3]) throw Error("Bad state: " + d.join("|"));
				tm(P), N.push(P);
			} else l.push([c[3], !1]), d = Kp(c[0]), J(d.ShowAlways || "0") || (N.hidden = !0), P = { a: d.Author };
			break;
		case "autofilter":
			if (c[1] === "/") {
				if ((d = l.pop())[0] !== c[3]) throw Error("Bad state: " + d.join("|"));
			} else if (c[0].charAt(c[0].length - 2) !== "/") {
				var W = Kp(c[0]);
				h["!autofilter"] = { ref: tu(W.Range).replace(/\$/g, "") }, l.push([c[3], !0]);
			}
			break;
		case "name": break;
		case "datavalidation":
			if (c[1] === "/") {
				if ((d = l.pop())[0] !== c[3]) throw Error("Bad state: " + d.join("|"));
			} else c[0].charAt(c[0].length - 2) !== "/" && l.push([c[3], !0]);
			break;
		case "pixelsperinch": break;
		case "componentoptions":
		case "documentproperties":
		case "customdocumentproperties":
		case "officedocumentsettings":
		case "pivottable":
		case "pivotcache":
		case "names":
		case "mapinfo":
		case "pagebreaks":
		case "querytable":
		case "sorting":
		case "schema":
		case "conditionalformatting":
		case "smarttagtype":
		case "smarttags":
		case "excelworkbook":
		case "workbookoptions":
		case "worksheetoptions":
			if (c[1] === "/") {
				if ((d = l.pop())[0] !== c[3]) throw Error("Bad state: " + d.join("|"));
			} else c[0].charAt(c[0].length - 2) !== "/" && l.push([c[3], !0]);
			break;
		case "null": break;
		default:
			if (l.length == 0 && c[3] == "document" || l.length == 0 && c[3] == "uof") return ph(i, n);
			var de = !0;
			switch (l[l.length - 1][0]) {
				case "officedocumentsettings":
					switch (c[3]) {
						case "allowpng": break;
						case "removepersonalinformation": break;
						case "downloadcomponents": break;
						case "locationofcomponents": break;
						case "colors": break;
						case "color": break;
						case "index": break;
						case "rgb": break;
						case "targetscreensize": break;
						case "readonlyrecommended": break;
						default: de = !1;
					}
					break;
				case "componentoptions":
					switch (c[3]) {
						case "toolbar": break;
						case "hideofficelogo": break;
						case "spreadsheetautofit": break;
						case "label": break;
						case "caption": break;
						case "maxheight": break;
						case "maxwidth": break;
						case "nextsheetnumber": break;
						default: de = !1;
					}
					break;
				case "excelworkbook":
					switch (c[3]) {
						case "date1904":
							B.WBProps.date1904 = !0;
							break;
						case "hidehorizontalscrollbar": break;
						case "hideverticalscrollbar": break;
						case "hideworkbooktabs": break;
						case "windowheight": break;
						case "windowwidth": break;
						case "windowtopx": break;
						case "windowtopy": break;
						case "tabratio": break;
						case "protectstructure": break;
						case "protectwindow": break;
						case "protectwindows": break;
						case "activesheet": break;
						case "displayinknotes": break;
						case "firstvisiblesheet": break;
						case "supbook": break;
						case "sheetname": break;
						case "sheetindex": break;
						case "sheetindexfirst": break;
						case "sheetindexlast": break;
						case "dll": break;
						case "acceptlabelsinformulas": break;
						case "donotsavelinkvalues": break;
						case "iteration": break;
						case "maxiterations": break;
						case "maxchange": break;
						case "path": break;
						case "xct": break;
						case "count": break;
						case "selectedsheets": break;
						case "calculation": break;
						case "uncalced": break;
						case "startupprompt": break;
						case "crn": break;
						case "externname": break;
						case "formula": break;
						case "colfirst": break;
						case "collast": break;
						case "wantadvise": break;
						case "boolean": break;
						case "error": break;
						case "text": break;
						case "ole": break;
						case "noautorecover": break;
						case "publishobjects": break;
						case "donotcalculatebeforesave": break;
						case "number": break;
						case "refmoder1c1": break;
						case "embedsavesmarttags": break;
						default: de = !1;
					}
					break;
				case "workbookoptions":
					switch (c[3]) {
						case "owcversion": break;
						case "height": break;
						case "width": break;
						default: de = !1;
					}
					break;
				case "worksheetoptions":
					switch (c[3]) {
						case "visible":
							if (c[0].slice(-2) !== "/>") if (c[1] === "/") switch (i.slice(ee, c.index)) {
								case "SheetHidden":
									ie.Hidden = 1;
									break;
								case "SheetVeryHidden":
									ie.Hidden = 2;
									break;
							}
							else ee = c.index + c[0].length;
							break;
						case "header":
							h["!margins"] || tf(h["!margins"] = {}, "xlml"), isNaN(+K(c[0]).Margin) || (h["!margins"].header = +K(c[0]).Margin);
							break;
						case "footer":
							h["!margins"] || tf(h["!margins"] = {}, "xlml"), isNaN(+K(c[0]).Margin) || (h["!margins"].footer = +K(c[0]).Margin);
							break;
						case "pagemargins":
							var fe = K(c[0]);
							h["!margins"] || tf(h["!margins"] = {}, "xlml"), isNaN(+fe.Top) || (h["!margins"].top = +fe.Top), isNaN(+fe.Left) || (h["!margins"].left = +fe.Left), isNaN(+fe.Right) || (h["!margins"].right = +fe.Right), isNaN(+fe.Bottom) || (h["!margins"].bottom = +fe.Bottom);
							break;
						case "displayrighttoleft":
							B.Views || (B.Views = []), B.Views[0] || (B.Views[0] = {}), B.Views[0].RTL = !0;
							break;
						case "freezepanes": break;
						case "frozennosplit": break;
						case "splithorizontal":
						case "splitvertical": break;
						case "donotdisplaygridlines": break;
						case "activerow": break;
						case "activecol": break;
						case "toprowbottompane": break;
						case "leftcolumnrightpane": break;
						case "unsynced": break;
						case "print": break;
						case "printerrors": break;
						case "panes": break;
						case "scale": break;
						case "pane": break;
						case "number": break;
						case "layout": break;
						case "pagesetup": break;
						case "selected": break;
						case "protectobjects": break;
						case "enableselection": break;
						case "protectscenarios": break;
						case "validprinterinfo": break;
						case "horizontalresolution": break;
						case "verticalresolution": break;
						case "numberofcopies": break;
						case "activepane": break;
						case "toprowvisible": break;
						case "leftcolumnvisible": break;
						case "fittopage": break;
						case "rangeselection": break;
						case "papersizeindex": break;
						case "pagelayoutzoom": break;
						case "pagebreakzoom": break;
						case "filteron": break;
						case "fitwidth": break;
						case "fitheight": break;
						case "commentslayout": break;
						case "zoom": break;
						case "lefttoright": break;
						case "gridlines": break;
						case "allowsort": break;
						case "allowfilter": break;
						case "allowinsertrows": break;
						case "allowdeleterows": break;
						case "allowinsertcols": break;
						case "allowdeletecols": break;
						case "allowinserthyperlinks": break;
						case "allowformatcells": break;
						case "allowsizecols": break;
						case "allowsizerows": break;
						case "nosummaryrowsbelowdetail":
							h["!outline"] || (h["!outline"] = {}), h["!outline"].above = !0;
							break;
						case "tabcolorindex": break;
						case "donotdisplayheadings": break;
						case "showpagelayoutzoom": break;
						case "nosummarycolumnsrightdetail":
							h["!outline"] || (h["!outline"] = {}), h["!outline"].left = !0;
							break;
						case "blackandwhite": break;
						case "donotdisplayzeros": break;
						case "displaypagebreak": break;
						case "rowcolheadings": break;
						case "donotdisplayoutline": break;
						case "noorientation": break;
						case "allowusepivottables": break;
						case "zeroheight": break;
						case "viewablerange": break;
						case "selection": break;
						case "protectcontents": break;
						default: de = !1;
					}
					break;
				case "pivottable":
				case "pivotcache":
					switch (c[3]) {
						case "immediateitemsondrop": break;
						case "showpagemultipleitemlabel": break;
						case "compactrowindent": break;
						case "location": break;
						case "pivotfield": break;
						case "orientation": break;
						case "layoutform": break;
						case "layoutsubtotallocation": break;
						case "layoutcompactrow": break;
						case "position": break;
						case "pivotitem": break;
						case "datatype": break;
						case "datafield": break;
						case "sourcename": break;
						case "parentfield": break;
						case "ptlineitems": break;
						case "ptlineitem": break;
						case "countofsameitems": break;
						case "item": break;
						case "itemtype": break;
						case "ptsource": break;
						case "cacheindex": break;
						case "consolidationreference": break;
						case "filename": break;
						case "reference": break;
						case "nocolumngrand": break;
						case "norowgrand": break;
						case "blanklineafteritems": break;
						case "hidden": break;
						case "subtotal": break;
						case "basefield": break;
						case "mapchilditems": break;
						case "function": break;
						case "refreshonfileopen": break;
						case "printsettitles": break;
						case "mergelabels": break;
						case "defaultversion": break;
						case "refreshname": break;
						case "refreshdate": break;
						case "refreshdatecopy": break;
						case "versionlastrefresh": break;
						case "versionlastupdate": break;
						case "versionupdateablemin": break;
						case "versionrefreshablemin": break;
						case "calculation": break;
						default: de = !1;
					}
					break;
				case "pagebreaks":
					switch (c[3]) {
						case "colbreaks": break;
						case "colbreak": break;
						case "rowbreaks": break;
						case "rowbreak": break;
						case "colstart": break;
						case "colend": break;
						case "rowend": break;
						default: de = !1;
					}
					break;
				case "autofilter":
					switch (c[3]) {
						case "autofiltercolumn": break;
						case "autofiltercondition": break;
						case "autofilterand": break;
						case "autofilteror": break;
						default: de = !1;
					}
					break;
				case "querytable":
					switch (c[3]) {
						case "id": break;
						case "autoformatfont": break;
						case "autoformatpattern": break;
						case "querysource": break;
						case "querytype": break;
						case "enableredirections": break;
						case "refreshedinxl9": break;
						case "urlstring": break;
						case "htmltables": break;
						case "connection": break;
						case "commandtext": break;
						case "refreshinfo": break;
						case "notitles": break;
						case "nextid": break;
						case "columninfo": break;
						case "overwritecells": break;
						case "donotpromptforfile": break;
						case "textwizardsettings": break;
						case "source": break;
						case "number": break;
						case "decimal": break;
						case "thousandseparator": break;
						case "trailingminusnumbers": break;
						case "formatsettings": break;
						case "fieldtype": break;
						case "delimiters": break;
						case "tab": break;
						case "comma": break;
						case "autoformatname": break;
						case "versionlastedit": break;
						case "versionlastrefresh": break;
						default: de = !1;
					}
					break;
				case "datavalidation":
					switch (c[3]) {
						case "range": break;
						case "type": break;
						case "min": break;
						case "max": break;
						case "sort": break;
						case "descending": break;
						case "order": break;
						case "casesensitive": break;
						case "value": break;
						case "errorstyle": break;
						case "errormessage": break;
						case "errortitle": break;
						case "inputmessage": break;
						case "inputtitle": break;
						case "combohide": break;
						case "inputhide": break;
						case "condition": break;
						case "qualifier": break;
						case "useblank": break;
						case "value1": break;
						case "value2": break;
						case "format": break;
						case "cellrangelist": break;
						default: de = !1;
					}
					break;
				case "sorting":
				case "conditionalformatting":
					switch (c[3]) {
						case "range": break;
						case "type": break;
						case "min": break;
						case "max": break;
						case "sort": break;
						case "descending": break;
						case "order": break;
						case "casesensitive": break;
						case "value": break;
						case "errorstyle": break;
						case "errormessage": break;
						case "errortitle": break;
						case "cellrangelist": break;
						case "inputmessage": break;
						case "inputtitle": break;
						case "combohide": break;
						case "inputhide": break;
						case "condition": break;
						case "qualifier": break;
						case "useblank": break;
						case "value1": break;
						case "value2": break;
						case "format": break;
						default: de = !1;
					}
					break;
				case "mapinfo":
				case "schema":
				case "data":
					switch (c[3]) {
						case "map": break;
						case "entry": break;
						case "range": break;
						case "xpath": break;
						case "field": break;
						case "xsdtype": break;
						case "filteron": break;
						case "aggregate": break;
						case "elementtype": break;
						case "attributetype": break;
						case "schema":
						case "element":
						case "complextype":
						case "datatype":
						case "all":
						case "attribute":
						case "extends": break;
						case "row": break;
						default: de = !1;
					}
					break;
				case "smarttags": break;
				default:
					de = !1;
					break;
			}
			if (de || c[3].match(/!\[CDATA/)) break;
			if (!l[l.length - 1][1]) throw "Unrecognized tag: " + c[3] + "|" + l.join("|");
			if (l[l.length - 1][0] === "customdocumentproperties") {
				if (c[0].slice(-2) === "/>") break;
				c[1] === "/" ? Xp(j, ae, M, i.slice(ee, c.index)) : (M = c, ee = c.index + c[0].length);
				break;
			}
			if (n.WTF) throw "Unrecognized tag: " + c[3] + "|" + l.join("|");
	}
	var pe = {};
	return !n.bookSheets && !n.bookProps && (pe.Sheets = f), pe.SheetNames = p, pe.Workbook = B, pe.SSF = gt(V), pe.Props = A, pe.Custprops = j, pe.bookType = "xlml", pe;
}
function rm(e, t) {
	switch (Uh(t = t || {}), t.type || "base64") {
		case "base64": return nm(S(e), t);
		case "binary":
		case "buffer":
		case "file": return nm(e, t);
		case "array": return nm(k(e), t);
	}
}
function im(e) {
	var t = {}, n = e.content;
	if (n.l = 28, t.AnsiUserType = n.read_shift(0, "lpstr-ansi"), t.AnsiClipboardFormat = ai(n), n.length - n.l <= 4) return t;
	var r = n.read_shift(4);
	if (r == 0 || r > 40 || (n.l -= 4, t.Reserved1 = n.read_shift(0, "lpstr-ansi"), n.length - n.l <= 4) || (r = n.read_shift(4), r !== 1907505652) || (t.UnicodeClipboardFormat = oi(n), r = n.read_shift(4), r == 0 || r > 40)) return t;
	n.l -= 4, t.Reserved2 = n.read_shift(0, "lpwstr");
}
var am = [
	60,
	1084,
	2066,
	2165,
	2175
];
function om(e, t, n, r, i) {
	var a = r, o = [], s = n.slice(n.l, n.l + a);
	if (i && i.enc && i.enc.insitu && s.length > 0) switch (e) {
		case 9:
		case 521:
		case 1033:
		case 2057:
		case 47:
		case 405:
		case 225:
		case 406:
		case 312:
		case 404:
		case 10: break;
		case 133: break;
		default: i.enc.insitu(s);
	}
	o.push(s), n.l += a;
	for (var c = nr(n, n.l), l = Mm[c], u = 0; l != null && am.indexOf(c) > -1;) a = nr(n, n.l + 2), u = n.l + 4, c == 2066 ? u += 4 : (c == 2165 || c == 2175) && (u += 12), s = n.slice(u, n.l + 4 + a), o.push(s), n.l += 4 + a, l = Mm[c = nr(n, n.l)];
	var d = j(o);
	pr(d, 0);
	var f = 0;
	d.lens = [];
	for (var p = 0; p < o.length; ++p) d.lens.push(f), f += o[p].length;
	if (d.length < r) throw "XLS Record 0x" + e.toString(16) + " Truncated: " + d.length + " < " + r;
	return t.f(d, d.length, i);
}
function sm(e, t, n) {
	if (e.t !== "z" && e.XF) {
		var r = 0;
		try {
			r = e.z || e.XF.numFmtId || 0, t.cellNF && e.z == null && (e.z = V[r]);
		} catch (e) {
			if (t.WTF) throw e;
		}
		if (!t || t.cellText !== !1) try {
			e.t === "e" ? e.w = e.w || Ei[e.v] : r === 0 || r == "General" ? e.t === "n" ? (e.v | 0) === e.v ? e.w = e.v.toString(10) : e.w = fe(e.v) : e.w = pe(e.v) : e.w = We(r, e.v, {
				date1904: !!n,
				dateNF: t && t.dateNF
			});
		} catch (e) {
			if (t.WTF) throw e;
		}
		if (t.cellDates && r && e.t == "n" && ze(V[r] || String(r))) {
			var i = H(e.v + (n ? 1462 : 0));
			i && (e.t = "d", e.v = new Date(Date.UTC(i.y, i.m - 1, i.d, i.H, i.M, i.S, i.u)));
		}
	}
}
function cm(e, t, n) {
	return {
		v: e,
		ixfe: t,
		t: n
	};
}
var lm = [
	"none",
	"thin",
	"medium",
	"dashed",
	"dotted",
	"thick",
	"double",
	"hair",
	"mediumDashed",
	"dashDot",
	"mediumDashDot",
	"dashDotDot",
	"mediumDashDotDot",
	"slantDashDot"
], um = [
	null,
	"left",
	"center",
	"right",
	"fill",
	"justify",
	"centerContinuous",
	"distributed"
], dm = [
	"top",
	"center",
	"bottom",
	"justify",
	"distributed"
];
function fm(e, t) {
	var n = e.l + t, r = {};
	return t >= 16 && (r.x = e.read_shift(4, "i"), r.y = e.read_shift(4, "i"), r.w = e.read_shift(4, "i"), r.h = e.read_shift(4, "i")), e.l = n, r;
}
function pm(e, t) {
	var n = e.l + t, r = {};
	return t >= 12 && (r.catType = e.read_shift(2), r.valType = e.read_shift(2), r.cCat = e.read_shift(2), r.cVal = e.read_shift(2), r.bubbleType = e.read_shift(2), r.cBubble = e.read_shift(2)), e.l = n, r;
}
function mm(e, t, n) {
	var r = e.l + t, i = {};
	t >= 2 && (i.id = e.read_shift(2));
	try {
		e.l < r && (i.text = ha(e, r - e.l, n));
	} catch {
		e.l = r;
	}
	return e.l = r, i;
}
function hm(e, t) {
	var n = e.l + t, r = {};
	return t >= 20 && (r.x = e.read_shift(4, "i"), r.y = e.read_shift(4, "i"), r.w = e.read_shift(4, "i"), r.h = e.read_shift(4, "i"), r.dock = e.read_shift(1), r.spacing = e.read_shift(1), r.flags = e.read_shift(2)), e.l = n, r;
}
function gm(e, t) {
	var n = e.l + t, r = {};
	return t >= 2 && (r.axisType = e.read_shift(2)), e.l = n, r;
}
function _m(e, t) {
	var n = e.l + t, r = {};
	return t >= 32 && (r.hAlign = e.read_shift(1), r.vAlign = e.read_shift(1), r.bgMode = e.read_shift(2), r.color = e.read_shift(4), r.x = e.read_shift(4, "i"), r.y = e.read_shift(4, "i"), r.w = e.read_shift(4, "i"), r.h = e.read_shift(4, "i")), e.l = n, r;
}
function vm(e, t) {
	var n = e.l + t, r = {};
	if (t >= 6) {
		r.id = e.read_shift(1), r.rt = e.read_shift(1), r.flags = e.read_shift(2);
		var i = e.read_shift(2);
		r.cce = i, r.formulaRaw = e.slice(e.l, Math.min(n, e.l + i));
	}
	return e.l = n, r;
}
function ym(e) {
	return function(t, n) {
		var r = t.l + n, i = { type: e };
		return n >= 2 && (i.flags = t.read_shift(2)), t.l = r, i;
	};
}
var bm = ym("barChart"), xm = ym("lineChart"), Sm = ym("pieChart"), Cm = ym("areaChart"), wm = ym("scatterChart"), Tm = ym("radarChart"), Em = ym("surfaceChart");
function Dm(e, t) {
	var n = { opts: {} }, r = {};
	_ != null && t.dense == null && (t.dense = _);
	var i = {};
	t.dense && (i["!data"] = []);
	var a = {}, o = {}, s = null, l = [], u = "", d = {}, f, p = "", m, h, g, v, y = {}, b = [], S, C, w = [], T = [], E = {}, D = [], O = {
		Sheets: [],
		WBProps: { date1904: !1 },
		Views: [{}]
	}, k = {}, A = !1, j = function(e) {
		return e < 8 ? Ti[e] : e < 64 && D[e - 8] || Ti[e];
	}, ee = function(e) {
		if (e == null) return null;
		var t = j(e), n = {
			indexed: e,
			index: e
		};
		return t && (n.rgb = Qs(t)), rc(n, B);
	}, M = function(e) {
		if (!e) return null;
		var t = {};
		switch (e.xclrType) {
			case 0:
				t.auto = 1;
				break;
			case 1:
				t = ee(e.xclrValue) || {};
				break;
			case 2:
				t.rgb = Qs(e.xclrValue);
				break;
			case 3:
				t.theme = e.xclrValue;
				break;
		}
		return e.nTintShade && (t.tint = e.nTintShade > 0 ? e.nTintShade / 32767 : e.nTintShade / 32768), rc(t, B);
	}, N = function(e, t) {
		if (!e) return null;
		var n = {};
		return e.name && (n.name = e.name), e.sz && (n.sz = e.sz), e.bold && (n.bold = !0), e.italic && (n.italic = !0), e.underline && (n.underline = e.underline), e.strike && (n.strike = !0), e.outline && (n.outline = !0), e.shadow && (n.shadow = !0), e.family != null && (n.family = e.family), e.charset != null && (n.charset = e.charset), e.vertAlign == 1 ? n.vertAlign = "superscript" : e.vertAlign == 2 && (n.vertAlign = "subscript"), t && t.fontScheme != null && (n.scheme = t.fontScheme == 1 ? "major" : t.fontScheme == 2 ? "minor" : "none"), n.color = M(t && t.xfextFont) || ee(e.icv), n.color && n.color.auto && delete n.color, n;
	}, P = function(e) {
		if (!e) return null;
		var t = { patternType: e.patternType || "none" }, n = M(e.xfextFore) || ee(e.icvFore), r = M(e.xfextBack) || ee(e.icvBack);
		return n && (t.fgColor = n), r && (t.bgColor = r), e.gradientFill && (t.gradientFill = e.gradientFill), t;
	}, F = function(e, t, n) {
		if (!e) return null;
		var r = { style: lm[e] || "thin" }, i = M(n) || ee(t);
		return i && (r.color = i), r;
	}, I = function(e) {
		if (!e) return null;
		var t = {}, n;
		return (n = F(e.dgLeft, e.icvLeft, e.xfextLeft)) && (t.left = n), (n = F(e.dgRight, e.icvRight, e.xfextRight)) && (t.right = n), (n = F(e.dgTop, e.icvTop, e.xfextTop)) && (t.top = n), (n = F(e.dgBottom, e.icvBottom, e.xfextBottom)) && (t.bottom = n), (n = F(e.dgDiag, e.icvDiag, e.xfextDiag)) && (t.diagonal = n), e.grbitDiag & 1 && (t.diagonalUp = !0), e.grbitDiag & 2 && (t.diagonalDown = !0), rt(t).length ? t : null;
	}, L = function(e) {
		if (!e) return null;
		var t = {};
		return um[e.alc] && (t.horizontal = um[e.alc]), dm[e.alcV] && e.alcV != 2 && (t.vertical = dm[e.alcV]), e.fWrap && (t.wrapText = !0), e.fShrinkToFit && (t.shrinkToFit = !0), e.trot && (t.textRotation = e.trot), e.cIndent && (t.indent = e.cIndent), e.iReadOrder && (t.readingOrder = e.iReadOrder), rt(t).length ? t : null;
	}, te = function(e, t) {
		if (!t) return e;
		var n = t.data || {};
		t.numFmtId != null && (e.numFmtId = t.numFmtId, V[t.numFmtId] != null && (e.numFmt = V[t.numFmtId]));
		var r = N(T[t.ifnt], t);
		r && (e.font = r);
		var i = P(n);
		i && (e.fill = i, rf(e, i));
		var a = I(n);
		a && (e.border = a);
		var o = L(n);
		return o && (e.alignment = o), (t.locked || t.hidden) && (e.protection = {
			locked: t.locked,
			hidden: t.hidden
		}), e;
	}, ne = function(e, t) {
		if (!e) return null;
		if (t == null && (t = w.indexOf(e)), E[t]) return E[t];
		var n = {
			id: t,
			xf: gt(e)
		};
		return !e.fStyle && e.xfId != null && e.xfId !== t && w[e.xfId] && nf(n, ne(w[e.xfId], e.xfId)), n.id = t, n.xf = gt(e), te(n, e), E[t] = n;
	}, re = function(e, t) {
		if (!(!e.XF || !t || !t.cellStyles)) {
			var n = ne(e.XF, e.ixfe);
			n && (e.s = n);
		}
	}, R = function(e, t, n) {
		if (!(!A && fe > 1) && !(n.sheetRows && e.r >= n.sheetRows)) {
			if (n.cellStyles && t.XF && t.XF.data && re(t, n), delete t.ixfe, delete t.XF, f = e, p = Y(e), (!o || !o.s || !o.e) && (o = {
				s: {
					r: 0,
					c: 0
				},
				e: {
					r: 0,
					c: 0
				}
			}), e.r < o.s.r && (o.s.r = e.r), e.c < o.s.c && (o.s.c = e.c), e.r + 1 > o.e.r && (o.e.r = e.r + 1), e.c + 1 > o.e.c && (o.e.c = e.c + 1), n.cellFormula && t.f) {
				for (var r = 0; r < b.length; ++r) if (!(b[r][0].s.c > e.c || b[r][0].s.r > e.r) && !(b[r][0].e.c < e.c || b[r][0].e.r < e.r)) {
					t.F = X(b[r][0]), (b[r][0].s.c != e.c || b[r][0].s.r != e.r) && delete t.f, t.f && (t.f = "" + Id(b[r][1], o, e, W, z));
					break;
				}
			}
			n.dense ? (i["!data"][e.r] || (i["!data"][e.r] = []), i["!data"][e.r][e.c] = t) : i[p] = t;
		}
	}, z = {
		enc: !1,
		sbcch: 0,
		snames: [],
		sharedf: y,
		arrayf: b,
		rrtabid: [],
		lastuser: "",
		biff: 8,
		codepage: 0,
		winlocked: 0,
		cellStyles: !!t && !!t.cellStyles,
		drawings: !!t && !!t.drawings,
		charts: !!t && !!t.charts,
		WTF: !!t && !!t.WTF
	};
	t.password && (z.password = t.password);
	var B, ie = [], ae = [], oe = [], se = [], ce = !1, le = { blips: [] }, H = null, ue = [], U = null, W = [];
	W.SheetNames = z.snames, W.sharedf = z.sharedf, W.arrayf = z.arrayf, W.names = [], W.XTI = [];
	var de = 0, fe = 0, pe = 0, me = [], he = [], ge, _e = function() {
		return H || (H = {
			raw: [],
			images: [],
			shapes: [],
			charts: []
		}), H;
	}, ve = function(e) {
		if (e && !(!t.drawings && !t.charts)) if (e.groups && e.blips) le.blips = le.blips.concat(e.blips);
		else {
			var n = _e();
			e.raw && n.raw.push(e.raw), e.blips && e.blips.length && (le.blips = le.blips.concat(e.blips)), (e.shapes || []).forEach(function(e) {
				ue.push(e);
				var t = e.blipId == null ? null : le.blips[e.blipId - 1];
				t && t.dataURI ? n.images.push({
					id: "xls-image-" + (n.images.length + 1),
					objectId: e.spid,
					biffType: "msoDrawing",
					anchor: e.anchor,
					dataURI: t.dataURI,
					contentType: t.contentType,
					raw: e.raw
				}) : n.shapes.push({
					id: "xls-shape-" + (n.shapes.length + 1),
					objectId: e.spid,
					biffType: "msoDrawing",
					anchor: e.anchor,
					props: e.props,
					raw: e.raw
				});
			});
		}
	}, ye = function(e) {
		if (!(!e || !e.ImData || !e.ImData.data) && !(!t.drawings && !t.charts)) {
			var n = _e(), r = e.ImData.data, i = zl(r, 0, r.length), a = e._shape || {}, o = {
				id: "xls-imdata-" + (n.images.length + 1),
				objectId: e.cmo && e.cmo[0],
				biffType: "imData",
				anchor: a.anchor,
				raw: e.ImData
			};
			i[1] ? (o.contentType = i[1], o.dataURI = "data:" + i[1] + ";base64," + x(r.slice(i[0])), n.images.push(o)) : n.shapes.push({
				id: "xls-imdata-" + (n.shapes.length + 1),
				objectId: o.objectId,
				biffType: "imData",
				anchor: a.anchor,
				raw: e.ImData
			});
		}
	}, be = function() {
		U = {
			type: null,
			title: "",
			series: [],
			seriesText: [],
			raw: [],
			current: null
		};
	}, xe = function(e, t) {
		switch (U || be(), U.raw.push({
			rt: e,
			v: t
		}), e) {
			case 4099:
				U.current = {
					raw: t,
					name: "",
					data: []
				}, U.series.push(U.current);
				break;
			case 4109:
				t && t.text && (U.current && !U.current.name ? U.current.name = t.text : U.title ? U.seriesText.push(t.text) : U.title = t.text);
				break;
			case 4119:
			case 4120:
			case 4121:
			case 4122:
			case 4123:
			case 4158:
			case 4159:
				t && t.type && (U.type = t.type);
				break;
			case 4177:
				U.current && (U.current.brai || (U.current.brai = []), U.current.brai.push(t));
				break;
		}
	}, Se = function(e) {
		if (!U || !U.raw.length) return null;
		var t = {
			type: U.type || "barChart",
			title: U.title,
			series: [],
			raw: U.raw
		};
		if (e && e["!ref"]) {
			var n = Pr(e["!ref"]), r = e["!data"] != null, i, a, o, s = !1;
			for (a = n.s.r; a <= n.e.r; ++a) o = r ? (e["!data"][a] || [])[n.s.c] : e[Y({
				r: a,
				c: n.s.c
			})], o && o.t == "n" && (s = !0);
			var c = [];
			if (!s && n.e.c > n.s.c) for (a = n.s.r; a <= n.e.r; ++a) o = r ? (e["!data"][a] || [])[n.s.c] : e[Y({
				r: a,
				c: n.s.c
			})], c.push(o ? o.w || o.v : "");
			for (i = n.s.c + +!!c.length; i <= n.e.c; ++i) {
				var l = [], u = (U.series[i - n.s.c] || U.series[i - n.s.c - 1] || {}).name || "";
				for (a = n.s.r; a <= n.e.r; ++a) o = r ? (e["!data"][a] || [])[i] : e[Y({
					r: a,
					c: i
				})], o && o.t == "n" ? l.push(o.v) : o && o.v != null && !isNaN(+o.v) && l.push(+o.v);
				l.length && t.series.push({
					name: u,
					data: l,
					val: { values: l },
					cat: { values: c }
				});
			}
		}
		return t.series.length || U.series.forEach(function(e) {
			t.series.push({
				name: e.name || "",
				data: [],
				raw: e
			});
		}), t;
	}, Ce = function(e) {
		if (e["!merges"] && e["!merges"].length) {
			var n = cf(e, { WTF: !!(t && (t.WTF || t.validateMerges)) });
			n.length && (e["!mergeErrors"] = n);
		}
		H && (H.images.length || H.shapes.length || H.charts.length || H.raw.length) && (e["!drawings"] = H);
		var r = t.charts ? Se(e) : null;
		r && (e["!chart"] = r, e["!charts"] || (e["!charts"] = []), H && H.charts.length ? H.charts.forEach(function(t) {
			t.model || (t.model = r), e["!charts"].push(t);
		}) : e["!charts"].push({
			id: "xls-chart-" + e["!charts"].length,
			title: r.title,
			model: r,
			raw: r.raw,
			anchor: {
				type: "absoluteAnchor",
				pos: {
					x: 0,
					y: 0
				},
				ext: {
					cx: 480 * 9525,
					cy: 288 * 9525
				}
			}
		}));
	};
	z.codepage = 1200, c(1200);
	for (var we = !1; e.l < e.length - 1;) {
		var Te = e.l, Ee = e.read_shift(2);
		if (Ee === 0 && de === 10) break;
		var De = e.l === e.length ? 0 : e.read_shift(2), Oe = Mm[Ee];
		if (fe == 0 && [
			9,
			521,
			1033,
			2057
		].indexOf(Ee) == -1) break;
		if (Oe && Oe.f) {
			if (t.bookSheets && de === 133 && Ee !== 133) break;
			if (de = Ee, Oe.r === 2 || Oe.r == 12) {
				var ke = e.read_shift(2);
				if (De -= 2, !z.enc && ke !== Ee && ((ke & 255) << 8 | ke >> 8) !== Ee) throw Error("rt mismatch: " + ke + "!=" + Ee);
				Oe.r == 12 && (e.l += 10, De -= 10);
			}
			var G = {};
			if (G = Ee === 10 ? Oe.f(e, De, z) : om(Ee, Oe, e, De, z), fe == 0 && [
				9,
				521,
				1033,
				2057
			].indexOf(de) === -1) continue;
			switch (Ee) {
				case 34:
					n.opts.Date1904 = O.WBProps.date1904 = G;
					break;
				case 134:
					n.opts.WriteProtect = !0;
					break;
				case 47:
					if (z.enc || (e.l = 0), z.enc = G, !t.password) throw Error("File is password-protected");
					if (G.valid == null) throw Error("Encryption scheme unsupported");
					if (!G.valid) throw Error("Password is incorrect");
					break;
				case 92:
					z.lastuser = G;
					break;
				case 66:
					var Ae = Number(G);
					switch (Ae) {
						case 21010:
							Ae = 1200;
							break;
						case 32768:
							Ae = 1e4;
							break;
						case 32769:
							Ae = 1252;
							break;
					}
					c(z.codepage = Ae), we = !0;
					break;
				case 317:
					z.rrtabid = G;
					break;
				case 25:
					z.winlocked = G;
					break;
				case 439:
					n.opts.RefreshAll = G;
					break;
				case 12:
					n.opts.CalcCount = G;
					break;
				case 16:
					n.opts.CalcDelta = G;
					break;
				case 17:
					n.opts.CalcIter = G;
					break;
				case 13:
					n.opts.CalcMode = G;
					break;
				case 14:
					n.opts.CalcPrecision = G;
					break;
				case 95:
					n.opts.CalcSaveRecalc = G;
					break;
				case 15:
					z.CalcRefMode = G;
					break;
				case 2211:
					n.opts.FullCalc = G;
					break;
				case 129:
					G.fDialog && (i["!type"] = "dialog"), G.fBelow || ((i["!outline"] || (i["!outline"] = {})).above = !0), G.fRight || ((i["!outline"] || (i["!outline"] = {})).left = !0);
					break;
				case 67:
				case 579:
				case 1091:
				case 224:
					w.push(G);
					break;
				case 49:
					T.push(G), z.biff >= 5 && T.length == 4 && T.push(null);
					break;
				case 430:
					W.push([G]), W[W.length - 1].XTI = [];
					break;
				case 35:
				case 547:
					W[W.length - 1].push(G);
					break;
				case 24:
				case 536:
					ge = {
						Name: G.Name,
						Ref: Id(G.rgce, o, null, W, z)
					}, G.itab > 0 && (ge.Sheet = G.itab - 1), W.names.push(ge), W[0] || (W[0] = [], W[0].XTI = []), W[W.length - 1].push(G), G.Name == "_xlnm._FilterDatabase" && G.itab > 0 && G.rgce && G.rgce[0] && G.rgce[0][0] && G.rgce[0][0][0] == "PtgArea3d" && (he[G.itab - 1] = { ref: X(G.rgce[0][0][1][2]) });
					break;
				case 22:
					z.ExternCount = G;
					break;
				case 23:
					W.length == 0 && (W[0] = [], W[0].XTI = []), W[W.length - 1].XTI = W[W.length - 1].XTI.concat(G), W.XTI = W.XTI.concat(G);
					break;
				case 2196:
					if (z.biff < 8) break;
					ge != null && (ge.Comment = G[1]);
					break;
				case 18:
					i["!protect"] = G;
					break;
				case 19:
					G !== 0 && z.WTF && console.error("Password verifier: " + G);
					break;
				case 133:
					a[z.biff == 4 ? z.snames.length : G.pos] = G, z.snames.push(G.name);
					break;
				case 10:
					if (--fe ? !A : A) break;
					if (o.e) {
						if (o.e.r > 0 && o.e.c > 0) {
							if (o.e.r--, o.e.c--, i["!ref"] = X(o), t.sheetRows && t.sheetRows <= o.e.r) {
								var je = o.e.r;
								o.e.r = t.sheetRows - 1, i["!fullref"] = i["!ref"], i["!ref"] = X(o), o.e.r = je;
							}
							o.e.r++, o.e.c++;
						}
						ie.length > 0 && (i["!merges"] = ie), ae.length > 0 && (i["!objects"] = ae), oe.length > 0 && (i["!cols"] = oe), se.length > 0 && (i["!rows"] = se), Ce(i), O.Sheets.push(k);
					}
					u === "" ? d = i : r[u] = i, i = {}, t.dense && (i["!data"] = []);
					break;
				case 9:
				case 521:
				case 1033:
				case 2057:
					if (z.biff === 8 && (z.biff = {
						9: 2,
						521: 3,
						1033: 4
					}[Ee] || {
						512: 2,
						768: 3,
						1024: 4,
						1280: 5,
						1536: 8,
						2: 2,
						7: 2
					}[G.BIFFVer] || 8), z.biffguess = G.BIFFVer == 0, G.BIFFVer == 0 && G.dt == 4096 && (z.biff = 5, we = !0, c(z.codepage = 28591)), z.biff == 4 && G.dt & 256 && (A = !0), z.biff == 8 && G.BIFFVer == 0 && G.dt == 16 && (z.biff = 2), fe++ && !A) break;
					if (i = {}, t.dense && (i["!data"] = []), z.biff < 8 && !we && (we = !0, c(z.codepage = t.codepage || 1252)), z.biff == 4 && A) u = (a[z.snames.indexOf(u) + 1] || { name: "" }).name;
					else if (z.biff < 5 || G.BIFFVer == 0 && G.dt == 4096) {
						u === "" && (u = "Sheet1"), o = {
							s: {
								r: 0,
								c: 0
							},
							e: {
								r: 0,
								c: 0
							}
						};
						var Me = {
							pos: e.l - De,
							name: u
						};
						a[Me.pos] = Me, z.snames.push(u);
					} else u = (a[Te] || { name: "" }).name;
					G.dt == 32 && (i["!type"] = "chart"), G.dt == 64 && (i["!type"] = "macro"), ie = [], ae = [], H = null, ue = [], be(), z.arrayf = b = [], oe = [], se = [], ce = !1, k = {
						Hidden: (a[Te] || { hs: 0 }).hs,
						name: u
					};
					break;
				case 515:
				case 3:
				case 2:
					i["!type"] == "chart" && (t.dense ? (i["!data"][G.r] || [])[G.c] : i[Dr(G.c) + Cr(G.r)]) && ++G.c, S = {
						ixfe: G.ixfe,
						XF: w[G.ixfe] || {},
						v: G.val,
						t: "n"
					}, pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R({
						c: G.c,
						r: G.r
					}, S, t);
					break;
				case 5:
				case 517:
					S = {
						ixfe: G.ixfe,
						XF: w[G.ixfe],
						v: G.val,
						t: G.t
					}, pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R({
						c: G.c,
						r: G.r
					}, S, t);
					break;
				case 638:
					S = {
						ixfe: G.ixfe,
						XF: w[G.ixfe],
						v: G.rknum,
						t: "n"
					}, pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R({
						c: G.c,
						r: G.r
					}, S, t);
					break;
				case 189:
					for (var Ne = G.c; Ne <= G.C; ++Ne) {
						var Pe = G.rkrec[Ne - G.c][0];
						S = {
							ixfe: Pe,
							XF: w[Pe],
							v: G.rkrec[Ne - G.c][1],
							t: "n"
						}, pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R({
							c: Ne,
							r: G.r
						}, S, t);
					}
					break;
				case 6:
				case 518:
				case 1030:
					if (G.val == "String") {
						s = G;
						break;
					}
					if (S = cm(G.val, G.cell.ixfe, G.tt), S.XF = w[S.ixfe], t.cellFormula) {
						var Fe = G.formula;
						if (Fe && Fe[0] && Fe[0][0] && Fe[0][0][0] == "PtgExp") {
							var Ie = Fe[0][0][1][0], Le = Fe[0][0][1][1], Re = Y({
								r: Ie,
								c: Le
							});
							y[Re] ? S.f = "" + Id(G.formula, o, G.cell, W, z) : S.F = ((t.dense ? (i["!data"][Ie] || [])[Le] : i[Re]) || {}).F;
						} else S.f = "" + Id(G.formula, o, G.cell, W, z);
					}
					pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R(G.cell, S, t), s = G;
					break;
				case 7:
				case 519:
					if (s) s.val = G, S = cm(G, s.cell.ixfe, "s"), S.XF = w[S.ixfe], t.cellFormula && (S.f = "" + Id(s.formula, o, s.cell, W, z)), pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R(s.cell, S, t), s = null;
					else throw Error("String record expects Formula");
					break;
				case 33:
				case 545:
					b.push(G);
					var ze = Y(G[0].s);
					if (m = t.dense ? (i["!data"][G[0].s.r] || [])[G[0].s.c] : i[ze], t.cellFormula && m) {
						if (!s || !ze || !m) break;
						m.f = "" + Id(G[1], o, G[0], W, z), m.F = X(G[0]);
					}
					break;
				case 1212:
					if (!t.cellFormula) break;
					if (p) {
						if (!s) break;
						y[Y(s.cell)] = G[0], m = t.dense ? (i["!data"][s.cell.r] || [])[s.cell.c] : i[Y(s.cell)], (m || {}).f = "" + Id(G[0], o, f, W, z);
					}
					break;
				case 253:
					S = cm(l[G.isst].t, G.ixfe, "s"), l[G.isst].h && (S.h = l[G.isst].h), S.XF = w[S.ixfe], pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R({
						c: G.c,
						r: G.r
					}, S, t);
					break;
				case 513:
					t.sheetStubs && (S = {
						ixfe: G.ixfe,
						XF: w[G.ixfe],
						t: "z"
					}, pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R({
						c: G.c,
						r: G.r
					}, S, t));
					break;
				case 190:
					if (t.sheetStubs) for (var Be = G.c; Be <= G.C; ++Be) {
						var Ve = G.ixfe[Be - G.c];
						S = {
							ixfe: Ve,
							XF: w[Ve],
							t: "z"
						}, pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R({
							c: Be,
							r: G.r
						}, S, t);
					}
					break;
				case 214:
				case 516:
				case 4:
					S = cm(G.val, G.ixfe, "s"), S.XF = w[S.ixfe], pe > 0 && (S.z = S.XF && S.XF.numFmtId && me[S.XF.numFmtId] || me[S.ixfe >> 8 & 63]), sm(S, t, n.opts.Date1904), R({
						c: G.c,
						r: G.r
					}, S, t);
					break;
				case 0:
				case 512:
					fe === 1 && (o = G);
					break;
				case 252:
					l = G;
					break;
				case 1054:
					if (z.biff >= 3 && z.biff <= 4) {
						me[pe++] = G[1];
						for (var He = 0; He < pe + 163 && V[He] != G[1]; ++He);
						He >= 163 && Qe(G[1], pe + 163);
					} else Qe(G[1], G[0]);
					break;
				case 30:
					me[pe++] = G;
					for (var Ue = 0; Ue < pe + 163 && V[Ue] != G; ++Ue);
					Ue >= 163 && Qe(G, pe + 163);
					break;
				case 229:
					ie = ie.concat(G);
					break;
				case 235:
					ve(G);
					break;
				case 236:
					ve(G);
					break;
				case 93:
					ae[G.cmo[0]] = z.lastobj = G, ue.length && (G._shape = ue.shift(), G._shape.object = G, G.cmo[1] == 5 && _e().charts.push({
						id: "xls-chart-object-" + G.cmo[0],
						objectId: G.cmo[0],
						biffType: "obj",
						anchor: G._shape.anchor,
						raw: G._shape.raw
					}));
					break;
				case 438:
					z.lastobj.TxO = G;
					break;
				case 127:
					z.lastobj.ImData = G, ye(z.lastobj);
					break;
				case 440:
					for (v = G[0].s.r; v <= G[0].e.r; ++v) for (g = G[0].s.c; g <= G[0].e.c; ++g) m = t.dense ? (i["!data"][v] || [])[g] : i[Y({
						c: g,
						r: v
					})], m && (m.l = G[1]);
					break;
				case 2048:
					for (v = G[0].s.r; v <= G[0].e.r; ++v) for (g = G[0].s.c; g <= G[0].e.c; ++g) m = t.dense ? (i["!data"][v] || [])[g] : i[Y({
						c: g,
						r: v
					})], m && m.l && (m.l.Tooltip = G[1]);
					break;
				case 28:
					if (m = t.dense ? (i["!data"][G[0].r] || [])[G[0].c] : i[Y(G[0])], m || (t.dense ? (i["!data"][G[0].r] || (i["!data"][G[0].r] = []), m = i["!data"][G[0].r][G[0].c] = { t: "z" }) : m = i[Y(G[0])] = { t: "z" }, o.e.r = Math.max(o.e.r, G[0].r), o.s.r = Math.min(o.s.r, G[0].r), o.e.c = Math.max(o.e.c, G[0].c), o.s.c = Math.min(o.s.c, G[0].c)), m.c || (m.c = []), z.biff <= 5 && z.biff >= 2) h = {
						a: "SheetJ5",
						t: G[1]
					};
					else {
						var We = ae[G[2]];
						h = {
							a: G[1],
							t: We.TxO.t
						}, G[3] != null && !(G[3] & 2) && (m.c.hidden = !0);
					}
					m.c.push(h);
					break;
				case 2173:
					_l(w[G.ixfe], G.ext), E = {};
					break;
				case 125:
					if (!z.cellStyles) break;
					for (; G.e >= G.s;) oe[G.e--] = {
						width: G.w / 256,
						level: G.level || 0,
						hidden: !!(G.flags & 1)
					}, G.ixfe != null && w[G.ixfe] && (oe[G.e + 1].s = ne(w[G.ixfe], G.ixfe)), ce || (ce = !0, pc(G.w / 256)), mc(oe[G.e + 1]);
					break;
				case 520:
					var Ge = {};
					G.level != null && (se[G.r] = Ge, Ge.level = G.level), G.hidden && (se[G.r] = Ge, Ge.hidden = !0), z.cellStyles && G.ixfe != null && G.ixfe != 4095 && w[G.ixfe] && (se[G.r] = Ge, Ge.s = ne(w[G.ixfe], G.ixfe)), G.hpt && (se[G.r] = Ge, Ge.hpt = G.hpt, Ge.hpx = Ic(G.hpt));
					break;
				case 38:
				case 39:
				case 40:
				case 41:
					i["!margins"] || tf(i["!margins"] = {}), i["!margins"][{
						38: "left",
						39: "right",
						40: "top",
						41: "bottom"
					}[Ee]] = G;
					break;
				case 161:
					i["!margins"] || tf(i["!margins"] = {}), i["!margins"].header = G.header, i["!margins"].footer = G.footer;
					break;
				case 574:
					G.RTL && (O.Views[0].RTL = !0);
					break;
				case 146:
					D = G, E = {};
					break;
				case 2198:
					B = G, E = {};
					break;
				case 140:
					C = G;
					break;
				case 4098:
				case 4099:
				case 4109:
				case 4116:
				case 4117:
				case 4119:
				case 4120:
				case 4121:
				case 4122:
				case 4123:
				case 4125:
				case 4127:
				case 4128:
				case 4133:
				case 4149:
				case 4154:
				case 4158:
				case 4159:
				case 4161:
				case 4165:
				case 4177:
					xe(Ee, G);
					break;
				case 442:
					u ? k.CodeName = G || k.name : O.WBProps.CodeName = G || "ThisWorkbook";
					break;
			}
		} else Oe || console.error("Missing Info for XLS Record 0x" + Ee.toString(16)), e.l += De;
	}
	return n.SheetNames = rt(a).sort(function(e, t) {
		return Number(e) - Number(t);
	}).map(function(e) {
		return a[e].name;
	}), t.bookSheets || (n.Sheets = r), !n.SheetNames.length && d["!ref"] ? (n.SheetNames.push("Sheet1"), n.Sheets && (n.Sheets.Sheet1 = d)) : n.Preamble = d, n.Sheets && he.forEach(function(e, t) {
		n.Sheets[n.SheetNames[t]]["!autofilter"] = e;
	}), n.Strings = l, n.SSF = gt(V), z.enc && (n.Encryption = z.enc), B && (n.Themes = B), n.Metadata = {}, C !== void 0 && (n.Metadata.Country = C), W.names.length > 0 && (O.Names = W.names), n.Workbook = O, n;
}
var Om = {
	SI: "e0859ff2f94f6810ab9108002b27b3d9",
	DSI: "02d5cdd59c2e1b10939708002b2cf9ae",
	UDI: "05d5cdd59c2e1b10939708002b2cf9ae"
};
function km(e, t, n) {
	var r = et.find(e, "/!DocumentSummaryInformation");
	if (r && r.size > 0) try {
		var i = ca(r, bi, Om.DSI);
		for (var a in i) t[a] = i[a];
	} catch (e) {
		n.WTF && console.error(e && e.message || e);
	}
	var o = et.find(e, "/!SummaryInformation");
	if (o && o.size > 0) try {
		var s = ca(o, xi, Om.SI);
		for (var c in s) t[c] == null && (t[c] = s[c]);
	} catch (e) {
		n.WTF && console.error(e && e.message || e);
	}
	t.HeadingPairs && t.TitlesOfParts && (Bi(t.HeadingPairs, t.TitlesOfParts, t, n), delete t.HeadingPairs, delete t.TitlesOfParts);
}
function Am(e, t) {
	t || (t = {}), Uh(t), l(), t.codepage && o(t.codepage);
	var n, r;
	if (e.FullPaths) {
		if (et.find(e, "/encryption")) throw Error("File is password-protected");
		n = et.find(e, "!CompObj"), r = et.find(e, "/Workbook") || et.find(e, "/Book");
	} else {
		switch (t.type) {
			case "base64":
				e = O(S(e));
				break;
			case "binary":
				e = O(e);
				break;
			case "buffer": break;
			case "array":
				Array.isArray(e) || (e = Array.prototype.slice.call(e));
				break;
		}
		pr(e, 0), r = { content: e };
	}
	var i, a;
	if (n && im(n), t.bookProps && !t.bookSheets) i = {};
	else {
		var s = C ? "buffer" : "array";
		if (r && r.content) i = Dm(r.content, t);
		else if ((a = et.find(e, "PerfectOffice_MAIN")) && a.content) i = ps.to_workbook(a.content, (t.type = s, t));
		else if ((a = et.find(e, "NativeContent_MAIN")) && a.content) i = ps.to_workbook(a.content, (t.type = s, t));
		else if ((a = et.find(e, "MN0")) && a.content) throw Error("Unsupported Works 4 for Mac file");
		else throw Error("Cannot find Workbook stream");
		t.bookVBA && e.FullPaths && et.find(e, "/_VBA_PROJECT_CUR/VBA/dir") && (i.vbaraw = Xl(e));
	}
	var c = {};
	return e.FullPaths && km(e, c, t), i.Props = i.Custprops = c, t.bookFiles && (i.cfb = e), i;
}
var jm = {
	0: { f: Df },
	1: { f: jf },
	2: { f: Vf },
	3: { f: Ff },
	4: { f: Nf },
	5: { f: zf },
	6: { f: Wf },
	7: { f: Lf },
	8: { f: Yf },
	9: { f: Jf },
	10: { f: Kf },
	11: { f: qf },
	12: { f: Mf },
	13: { f: Hf },
	14: { f: If },
	15: { f: Pf },
	16: { f: Bf },
	17: { f: Gf },
	18: { f: Rf },
	19: { f: Wr },
	20: {},
	21: {},
	22: {},
	23: {},
	24: {},
	25: {},
	26: {},
	27: {},
	28: {},
	29: {},
	30: {},
	31: {},
	32: {},
	33: {},
	34: {},
	35: { T: 1 },
	36: { T: -1 },
	37: { T: 1 },
	38: { T: -1 },
	39: { f: jp },
	40: {},
	42: {},
	43: { f: el },
	44: { f: $c },
	45: { f: tl },
	46: { f: rl },
	47: { f: nl },
	48: {},
	49: { f: Vr },
	50: {},
	51: { f: yl },
	52: { T: 1 },
	53: { T: -1 },
	54: { T: 1 },
	55: { T: -1 },
	56: { T: 1 },
	57: { T: -1 },
	58: {},
	59: {},
	60: { f: Wo },
	62: { f: Uf },
	63: { f: wl },
	64: { f: ip },
	65: {},
	66: {},
	67: {},
	68: {},
	69: {},
	70: {},
	128: {},
	129: { T: 1 },
	130: { T: -1 },
	131: {
		T: 1,
		f: mr,
		p: 0
	},
	132: { T: -1 },
	133: { T: 1 },
	134: { T: -1 },
	135: { T: 1 },
	136: { T: -1 },
	137: {
		T: 1,
		f: rp
	},
	138: { T: -1 },
	139: { T: 1 },
	140: { T: -1 },
	141: { T: 1 },
	142: { T: -1 },
	143: { T: 1 },
	144: { T: -1 },
	145: { T: 1 },
	146: { T: -1 },
	147: { f: Af },
	148: {
		f: Of,
		p: 16
	},
	151: { f: Qf },
	152: {},
	153: { f: kp },
	154: {},
	155: {},
	156: { f: Op },
	157: {},
	158: {},
	159: {
		T: 1,
		f: Cs
	},
	160: { T: -1 },
	161: {
		T: 1,
		f: ei
	},
	162: { T: -1 },
	163: { T: 1 },
	164: { T: -1 },
	165: { T: 1 },
	166: { T: -1 },
	167: {},
	168: {},
	169: {},
	170: {},
	171: {},
	172: { T: 1 },
	173: { T: -1 },
	174: {},
	175: {},
	176: { f: Xf },
	177: { T: 1 },
	178: { T: -1 },
	179: { T: 1 },
	180: { T: -1 },
	181: { T: 1 },
	182: { T: -1 },
	183: { T: 1 },
	184: { T: -1 },
	185: { T: 1 },
	186: { T: -1 },
	187: { T: 1 },
	188: { T: -1 },
	189: { T: 1 },
	190: { T: -1 },
	191: { T: 1 },
	192: { T: -1 },
	193: { T: 1 },
	194: { T: -1 },
	195: { T: 1 },
	196: { T: -1 },
	197: { T: 1 },
	198: { T: -1 },
	199: { T: 1 },
	200: { T: -1 },
	201: { T: 1 },
	202: { T: -1 },
	203: { T: 1 },
	204: { T: -1 },
	205: { T: 1 },
	206: { T: -1 },
	207: { T: 1 },
	208: { T: -1 },
	209: { T: 1 },
	210: { T: -1 },
	211: { T: 1 },
	212: { T: -1 },
	213: { T: 1 },
	214: { T: -1 },
	215: { T: 1 },
	216: { T: -1 },
	217: { T: 1 },
	218: { T: -1 },
	219: { T: 1 },
	220: { T: -1 },
	221: { T: 1 },
	222: { T: -1 },
	223: { T: 1 },
	224: { T: -1 },
	225: { T: 1 },
	226: { T: -1 },
	227: { T: 1 },
	228: { T: -1 },
	229: { T: 1 },
	230: { T: -1 },
	231: { T: 1 },
	232: { T: -1 },
	233: { T: 1 },
	234: { T: -1 },
	235: { T: 1 },
	236: { T: -1 },
	237: { T: 1 },
	238: { T: -1 },
	239: { T: 1 },
	240: { T: -1 },
	241: { T: 1 },
	242: { T: -1 },
	243: { T: 1 },
	244: { T: -1 },
	245: { T: 1 },
	246: { T: -1 },
	247: { T: 1 },
	248: { T: -1 },
	249: { T: 1 },
	250: { T: -1 },
	251: { T: 1 },
	252: { T: -1 },
	253: { T: 1 },
	254: { T: -1 },
	255: { T: 1 },
	256: { T: -1 },
	257: { T: 1 },
	258: { T: -1 },
	259: { T: 1 },
	260: { T: -1 },
	261: { T: 1 },
	262: { T: -1 },
	263: { T: 1 },
	264: { T: -1 },
	265: { T: 1 },
	266: { T: -1 },
	267: { T: 1 },
	268: { T: -1 },
	269: { T: 1 },
	270: { T: -1 },
	271: { T: 1 },
	272: { T: -1 },
	273: { T: 1 },
	274: { T: -1 },
	275: { T: 1 },
	276: { T: -1 },
	277: {},
	278: { T: 1 },
	279: { T: -1 },
	280: { T: 1 },
	281: { T: -1 },
	282: { T: 1 },
	283: { T: 1 },
	284: { T: -1 },
	285: { T: 1 },
	286: { T: -1 },
	287: { T: 1 },
	288: { T: -1 },
	289: { T: 1 },
	290: { T: -1 },
	291: { T: 1 },
	292: { T: -1 },
	293: { T: 1 },
	294: { T: -1 },
	295: { T: 1 },
	296: { T: -1 },
	297: { T: 1 },
	298: { T: -1 },
	299: { T: 1 },
	300: { T: -1 },
	301: { T: 1 },
	302: { T: -1 },
	303: { T: 1 },
	304: { T: -1 },
	305: { T: 1 },
	306: { T: -1 },
	307: { T: 1 },
	308: { T: -1 },
	309: { T: 1 },
	310: { T: -1 },
	311: { T: 1 },
	312: { T: -1 },
	313: { T: -1 },
	314: { T: 1 },
	315: { T: -1 },
	316: { T: 1 },
	317: { T: -1 },
	318: { T: 1 },
	319: { T: -1 },
	320: { T: 1 },
	321: { T: -1 },
	322: { T: 1 },
	323: { T: -1 },
	324: { T: 1 },
	325: { T: -1 },
	326: { T: 1 },
	327: { T: -1 },
	328: { T: 1 },
	329: { T: -1 },
	330: { T: 1 },
	331: { T: -1 },
	332: { T: 1 },
	333: { T: -1 },
	334: { T: 1 },
	335: { f: vl },
	336: { T: -1 },
	337: {
		f: bl,
		T: 1
	},
	338: { T: -1 },
	339: { T: 1 },
	340: { T: -1 },
	341: { T: 1 },
	342: { T: -1 },
	343: { T: 1 },
	344: { T: -1 },
	345: { T: 1 },
	346: { T: -1 },
	347: { T: 1 },
	348: { T: -1 },
	349: { T: 1 },
	350: { T: -1 },
	351: {},
	352: {},
	353: { T: 1 },
	354: { T: -1 },
	355: { f: Zr },
	357: {},
	358: {},
	359: {},
	360: { T: 1 },
	361: {},
	362: { f: To },
	363: {},
	364: {},
	366: {},
	367: {},
	368: {},
	369: {},
	370: {},
	371: {},
	372: { T: 1 },
	373: { T: -1 },
	374: { T: 1 },
	375: { T: -1 },
	376: { T: 1 },
	377: { T: -1 },
	378: { T: 1 },
	379: { T: -1 },
	380: { T: 1 },
	381: { T: -1 },
	382: { T: 1 },
	383: { T: -1 },
	384: { T: 1 },
	385: { T: -1 },
	386: { T: 1 },
	387: { T: -1 },
	388: { T: 1 },
	389: { T: -1 },
	390: { T: 1 },
	391: { T: -1 },
	392: { T: 1 },
	393: { T: -1 },
	394: { T: 1 },
	395: { T: -1 },
	396: {},
	397: {},
	398: {},
	399: {},
	400: {},
	401: { T: 1 },
	403: {},
	404: {},
	405: {},
	406: {},
	407: {},
	408: {},
	409: {},
	410: {},
	411: {},
	412: {},
	413: {},
	414: {},
	415: {},
	416: {},
	417: {},
	418: {},
	419: {},
	420: {},
	421: {},
	422: { T: 1 },
	423: { T: 1 },
	424: { T: -1 },
	425: { T: -1 },
	426: { f: $f },
	427: { f: ep },
	428: {},
	429: { T: 1 },
	430: { T: -1 },
	431: { T: 1 },
	432: { T: -1 },
	433: { T: 1 },
	434: { T: -1 },
	435: { T: 1 },
	436: { T: -1 },
	437: { T: 1 },
	438: { T: -1 },
	439: { T: 1 },
	440: { T: -1 },
	441: { T: 1 },
	442: { T: -1 },
	443: { T: 1 },
	444: { T: -1 },
	445: { T: 1 },
	446: { T: -1 },
	447: { T: 1 },
	448: { T: -1 },
	449: { T: 1 },
	450: { T: -1 },
	451: { T: 1 },
	452: { T: -1 },
	453: { T: 1 },
	454: { T: -1 },
	455: { T: 1 },
	456: { T: -1 },
	457: { T: 1 },
	458: { T: -1 },
	459: { T: 1 },
	460: { T: -1 },
	461: { T: 1 },
	462: { T: -1 },
	463: { T: 1 },
	464: { T: -1 },
	465: { T: 1 },
	466: { T: -1 },
	467: { T: 1 },
	468: { T: -1 },
	469: { T: 1 },
	470: { T: -1 },
	471: {},
	472: {},
	473: { T: 1 },
	474: { T: -1 },
	475: {},
	476: { f: np },
	477: {},
	478: {},
	479: { T: 1 },
	480: { T: -1 },
	481: { T: 1 },
	482: { T: -1 },
	483: { T: 1 },
	484: { T: -1 },
	485: { f: kf },
	486: { T: 1 },
	487: { T: -1 },
	488: { T: 1 },
	489: { T: -1 },
	490: { T: 1 },
	491: { T: -1 },
	492: { T: 1 },
	493: { T: -1 },
	494: { f: Zf },
	495: { T: 1 },
	496: { T: -1 },
	497: { T: 1 },
	498: { T: -1 },
	499: {},
	500: { T: 1 },
	501: { T: -1 },
	502: { T: 1 },
	503: { T: -1 },
	504: {},
	505: { T: 1 },
	506: { T: -1 },
	507: {},
	508: { T: 1 },
	509: { T: -1 },
	510: { T: 1 },
	511: { T: -1 },
	512: {},
	513: {},
	514: { T: 1 },
	515: { T: -1 },
	516: { T: 1 },
	517: { T: -1 },
	518: { T: 1 },
	519: { T: -1 },
	520: { T: 1 },
	521: { T: -1 },
	522: {},
	523: {},
	524: {},
	525: {},
	526: {},
	527: {},
	528: { T: 1 },
	529: { T: -1 },
	530: { T: 1 },
	531: { T: -1 },
	532: { T: 1 },
	533: { T: -1 },
	534: {},
	535: {},
	536: {},
	537: {},
	538: { T: 1 },
	539: { T: -1 },
	540: { T: 1 },
	541: { T: -1 },
	542: { T: 1 },
	548: {},
	549: {},
	550: { f: Zr },
	551: { f: Yr },
	552: {},
	553: {},
	554: { T: 1 },
	555: { T: -1 },
	556: { T: 1 },
	557: { T: -1 },
	558: { T: 1 },
	559: { T: -1 },
	560: { T: 1 },
	561: { T: -1 },
	562: {},
	564: {},
	565: { T: 1 },
	566: { T: -1 },
	569: { T: 1 },
	570: { T: -1 },
	572: {},
	573: { T: 1 },
	574: { T: -1 },
	577: {},
	578: {},
	579: {},
	580: {},
	581: {},
	582: {},
	583: {},
	584: {},
	585: {},
	586: {},
	587: {},
	588: { T: -1 },
	589: {},
	590: { T: 1 },
	591: { T: -1 },
	592: { T: 1 },
	593: { T: -1 },
	594: { T: 1 },
	595: { T: -1 },
	596: {},
	597: { T: 1 },
	598: { T: -1 },
	599: { T: 1 },
	600: { T: -1 },
	601: { T: 1 },
	602: { T: -1 },
	603: { T: 1 },
	604: { T: -1 },
	605: { T: 1 },
	606: { T: -1 },
	607: {},
	608: { T: 1 },
	609: { T: -1 },
	610: {},
	611: { T: 1 },
	612: { T: -1 },
	613: { T: 1 },
	614: { T: -1 },
	615: { T: 1 },
	616: { T: -1 },
	617: { T: 1 },
	618: { T: -1 },
	619: { T: 1 },
	620: { T: -1 },
	625: {},
	626: { T: 1 },
	627: { T: -1 },
	628: { T: 1 },
	629: { T: -1 },
	630: { T: 1 },
	631: { T: -1 },
	632: { f: ql },
	633: { T: 1 },
	634: { T: -1 },
	635: {
		T: 1,
		f: Kl
	},
	636: { T: -1 },
	637: { f: Gr },
	638: { T: 1 },
	639: {},
	640: { T: -1 },
	641: { T: 1 },
	642: { T: -1 },
	643: { T: 1 },
	644: {},
	645: { T: -1 },
	646: { T: 1 },
	648: { T: 1 },
	649: {},
	650: { T: -1 },
	651: { f: hp },
	652: {},
	653: { T: 1 },
	654: { T: -1 },
	655: { T: 1 },
	656: { T: -1 },
	657: { T: 1 },
	658: { T: -1 },
	659: {},
	660: { T: 1 },
	661: {},
	662: { T: -1 },
	663: {},
	664: { T: 1 },
	665: {},
	666: { T: -1 },
	667: {},
	668: {},
	669: {},
	671: { T: 1 },
	672: { T: -1 },
	673: { T: 1 },
	674: { T: -1 },
	675: {},
	676: {},
	677: {},
	678: {},
	679: {},
	680: {},
	681: {},
	1024: {},
	1025: {},
	1026: { T: 1 },
	1027: { T: -1 },
	1028: { T: 1 },
	1029: { T: -1 },
	1030: {},
	1031: { T: 1 },
	1032: { T: -1 },
	1033: { T: 1 },
	1034: { T: -1 },
	1035: {},
	1036: {},
	1037: {},
	1038: { T: 1 },
	1039: { T: -1 },
	1040: {},
	1041: { T: 1 },
	1042: { T: -1 },
	1043: {},
	1044: {},
	1045: {},
	1046: { T: 1 },
	1047: { T: -1 },
	1048: { T: 1 },
	1049: { T: -1 },
	1050: {},
	1051: { T: 1 },
	1052: { T: 1 },
	1053: { f: ap },
	1054: { T: 1 },
	1055: {},
	1056: { T: 1 },
	1057: { T: -1 },
	1058: { T: 1 },
	1059: { T: -1 },
	1061: {},
	1062: { T: 1 },
	1063: { T: -1 },
	1064: { T: 1 },
	1065: { T: -1 },
	1066: { T: 1 },
	1067: { T: -1 },
	1068: { T: 1 },
	1069: { T: -1 },
	1070: { T: 1 },
	1071: { T: -1 },
	1072: { T: 1 },
	1073: { T: -1 },
	1075: { T: 1 },
	1076: { T: -1 },
	1077: { T: 1 },
	1078: { T: -1 },
	1079: { T: 1 },
	1080: { T: -1 },
	1081: { T: 1 },
	1082: { T: -1 },
	1083: { T: 1 },
	1084: { T: -1 },
	1085: {},
	1086: { T: 1 },
	1087: { T: -1 },
	1088: { T: 1 },
	1089: { T: -1 },
	1090: { T: 1 },
	1091: { T: -1 },
	1092: { T: 1 },
	1093: { T: -1 },
	1094: { T: 1 },
	1095: { T: -1 },
	1096: {},
	1097: { T: 1 },
	1098: {},
	1099: { T: -1 },
	1100: { T: 1 },
	1101: { T: -1 },
	1102: {},
	1103: {},
	1104: {},
	1105: {},
	1111: {},
	1112: {},
	1113: { T: 1 },
	1114: { T: -1 },
	1115: { T: 1 },
	1116: { T: -1 },
	1117: {},
	1118: { T: 1 },
	1119: { T: -1 },
	1120: { T: 1 },
	1121: { T: -1 },
	1122: { T: 1 },
	1123: { T: -1 },
	1124: { T: 1 },
	1125: { T: -1 },
	1126: {},
	1128: { T: 1 },
	1129: { T: -1 },
	1130: {},
	1131: { T: 1 },
	1132: { T: -1 },
	1133: { T: 1 },
	1134: { T: -1 },
	1135: { T: 1 },
	1136: { T: -1 },
	1137: { T: 1 },
	1138: { T: -1 },
	1139: { T: 1 },
	1140: { T: -1 },
	1141: {},
	1142: { T: 1 },
	1143: { T: -1 },
	1144: { T: 1 },
	1145: { T: -1 },
	1146: {},
	1147: { T: 1 },
	1148: { T: -1 },
	1149: { T: 1 },
	1150: { T: -1 },
	1152: { T: 1 },
	1153: { T: -1 },
	1154: { T: -1 },
	1155: { T: -1 },
	1156: { T: -1 },
	1157: { T: 1 },
	1158: { T: -1 },
	1159: { T: 1 },
	1160: { T: -1 },
	1161: { T: 1 },
	1162: { T: -1 },
	1163: { T: 1 },
	1164: { T: -1 },
	1165: { T: 1 },
	1166: { T: -1 },
	1167: { T: 1 },
	1168: { T: -1 },
	1169: { T: 1 },
	1170: { T: -1 },
	1171: {},
	1172: { T: 1 },
	1173: { T: -1 },
	1177: {},
	1178: { T: 1 },
	1180: {},
	1181: {},
	1182: {},
	2048: { T: 1 },
	2049: { T: -1 },
	2050: {},
	2051: { T: 1 },
	2052: { T: -1 },
	2053: {},
	2054: {},
	2055: { T: 1 },
	2056: { T: -1 },
	2057: { T: 1 },
	2058: { T: -1 },
	2060: {},
	2067: {},
	2068: { T: 1 },
	2069: { T: -1 },
	2070: {},
	2071: {},
	2072: { T: 1 },
	2073: { T: -1 },
	2075: {},
	2076: {},
	2077: { T: 1 },
	2078: { T: -1 },
	2079: {},
	2080: { T: 1 },
	2081: { T: -1 },
	2082: {},
	2083: { T: 1 },
	2084: { T: -1 },
	2085: { T: 1 },
	2086: { T: -1 },
	2087: { T: 1 },
	2088: { T: -1 },
	2089: { T: 1 },
	2090: { T: -1 },
	2091: {},
	2092: {},
	2093: { T: 1 },
	2094: { T: -1 },
	2095: {},
	2096: { T: 1 },
	2097: { T: -1 },
	2098: { T: 1 },
	2099: { T: -1 },
	2100: { T: 1 },
	2101: { T: -1 },
	2102: {},
	2103: { T: 1 },
	2104: { T: -1 },
	2105: {},
	2106: { T: 1 },
	2107: { T: -1 },
	2108: {},
	2109: { T: 1 },
	2110: { T: -1 },
	2111: { T: 1 },
	2112: { T: -1 },
	2113: { T: 1 },
	2114: { T: -1 },
	2115: {},
	2116: {},
	2117: {},
	2118: { T: 1 },
	2119: { T: -1 },
	2120: {},
	2121: { T: 1 },
	2122: { T: -1 },
	2123: { T: 1 },
	2124: { T: -1 },
	2125: {},
	2126: { T: 1 },
	2127: { T: -1 },
	2128: {},
	2129: { T: 1 },
	2130: { T: -1 },
	2131: { T: 1 },
	2132: { T: -1 },
	2133: { T: 1 },
	2134: {},
	2135: {},
	2136: {},
	2137: { T: 1 },
	2138: { T: -1 },
	2139: { T: 1 },
	2140: { T: -1 },
	2141: {},
	3072: {},
	3073: {},
	4096: { T: 1 },
	4097: { T: -1 },
	5002: { T: 1 },
	5003: { T: -1 },
	5081: { T: 1 },
	5082: { T: -1 },
	5083: {},
	5084: { T: 1 },
	5085: { T: -1 },
	5086: { T: 1 },
	5087: { T: -1 },
	5088: {},
	5089: {},
	5090: {},
	5092: { T: 1 },
	5093: { T: -1 },
	5094: {},
	5095: { T: 1 },
	5096: { T: -1 },
	5097: {},
	5099: {},
	5100: {},
	5101: {},
	5102: {},
	5103: {},
	5105: {},
	5108: {},
	5109: {},
	5110: {},
	5111: {},
	5112: {},
	5113: {},
	5114: {},
	5117: {},
	5127: {},
	5130: {},
	5131: {},
	5132: {},
	5134: {},
	5135: {},
	65535: { n: "" }
}, Mm = {
	6: { f: Hd },
	10: { f: la },
	12: { f: fa },
	13: { f: fa },
	14: { f: da },
	15: { f: da },
	16: { f: ti },
	17: { f: da },
	18: { f: da },
	19: { f: fa },
	20: { f: xo },
	21: { f: xo },
	23: { f: To },
	24: { f: wo },
	25: { f: da },
	26: {},
	27: {},
	28: { f: Mo },
	29: {},
	34: { f: da },
	35: { f: Co },
	38: { f: ti },
	39: { f: ti },
	40: { f: ti },
	41: { f: ti },
	42: { f: da },
	43: { f: da },
	47: { f: qs },
	49: { f: ro },
	51: { f: fa },
	60: {},
	61: { f: eo },
	64: { f: da },
	65: { f: no },
	66: { f: fa },
	77: {},
	80: {},
	81: {},
	82: {},
	85: { f: fa },
	89: {},
	90: {},
	91: {},
	92: { f: Ga },
	93: { f: Po },
	94: {},
	95: { f: da },
	96: {},
	97: {},
	99: { f: da },
	125: { f: Wo },
	128: { f: vo },
	129: { f: Ka },
	130: { f: fa },
	131: { f: da },
	132: { f: da },
	133: { f: qa },
	134: {},
	140: { f: Bo },
	141: { f: fa },
	144: {},
	146: { f: Ho },
	151: {},
	152: {},
	153: {},
	154: {},
	155: {},
	156: { f: fa },
	157: {},
	158: {},
	160: { f: Jo },
	161: { f: Go },
	174: {},
	175: {},
	176: {},
	177: {},
	178: {},
	180: {},
	181: {},
	182: {},
	184: {},
	185: {},
	189: { f: uo },
	190: { f: fo },
	193: { f: la },
	197: {},
	198: {},
	199: {},
	200: {},
	201: {},
	202: { f: da },
	203: {},
	204: {},
	205: {},
	206: {},
	207: {},
	208: {},
	209: {},
	210: {},
	211: {},
	213: {},
	215: {},
	216: {},
	217: {},
	218: { f: fa },
	220: {},
	221: { f: da },
	222: {},
	224: { f: mo },
	225: { f: Wa },
	226: { f: la },
	227: {},
	229: { f: No },
	233: {},
	235: { f: jl },
	236: { f: Ml },
	237: {},
	239: {},
	240: {},
	241: {},
	242: {},
	244: {},
	245: {},
	246: {},
	247: {},
	248: {},
	249: {},
	251: {},
	252: { f: Ja },
	253: { f: io },
	255: { f: Ya },
	256: {},
	259: {},
	290: {},
	311: {},
	312: {},
	315: {},
	317: { f: pa },
	318: {},
	319: {},
	320: {},
	330: {},
	331: {},
	333: {},
	334: {},
	335: {},
	336: {},
	337: {},
	338: {},
	339: {},
	340: {},
	351: {},
	352: { f: da },
	353: { f: la },
	401: {},
	402: {},
	403: {},
	404: {},
	405: {},
	406: {},
	407: {},
	408: {},
	425: {},
	426: {},
	427: {},
	428: {},
	429: {},
	430: { f: So },
	431: { f: da },
	432: {},
	433: {},
	434: {},
	437: {},
	438: { f: Lo },
	439: { f: da },
	440: { f: Ro },
	441: {},
	442: { f: va },
	443: {},
	444: { f: fa },
	445: {},
	446: {},
	448: { f: la },
	449: {
		f: Qa,
		r: 2
	},
	450: { f: la },
	512: { f: co },
	513: { f: qo },
	515: { f: bo },
	516: { f: ao },
	517: { f: yo },
	519: { f: Yo },
	520: { f: Xa },
	523: {},
	545: { f: ko },
	549: { f: $a },
	566: {},
	574: { f: to },
	638: { f: lo },
	659: {},
	1048: {},
	1054: { f: oo },
	1084: {},
	1212: { f: Oo },
	2048: { f: zo },
	2049: {},
	2050: {},
	2051: {},
	2052: {},
	2053: {},
	2054: {},
	2055: {},
	2056: {},
	2057: { f: Ua },
	2058: {},
	2059: {},
	2060: {},
	2061: {},
	2062: {},
	2063: {},
	2064: {},
	2066: {},
	2067: {},
	2128: {},
	2129: {},
	2130: {},
	2131: {},
	2132: {},
	2133: {},
	2134: {},
	2135: {},
	2136: {},
	2137: {},
	2138: {},
	2146: {},
	2147: { r: 12 },
	2148: {},
	2149: {},
	2150: {},
	2151: { f: la },
	2152: {},
	2154: {},
	2155: {},
	2156: {},
	2161: {},
	2162: {},
	2164: {},
	2165: {},
	2166: {},
	2167: {},
	2168: {},
	2169: {},
	2170: {},
	2171: {},
	2172: {
		f: Uo,
		r: 12
	},
	2173: {
		f: gl,
		r: 12
	},
	2174: {},
	2175: {},
	2180: {},
	2181: {},
	2182: {},
	2183: {},
	2184: {},
	2185: {},
	2186: {},
	2187: {},
	2188: {
		f: da,
		r: 12
	},
	2189: {},
	2190: { r: 12 },
	2191: {},
	2192: {},
	2194: {},
	2195: {},
	2196: {
		f: Do,
		r: 12
	},
	2197: {},
	2198: {
		f: ul,
		r: 12
	},
	2199: {},
	2200: {},
	2201: {},
	2202: {
		f: Ao,
		r: 12
	},
	2203: { f: la },
	2204: {},
	2205: {},
	2206: {},
	2207: {},
	2211: { f: Za },
	2212: {},
	2213: {},
	2214: {},
	2215: {},
	4097: {},
	4098: { f: fm },
	4099: { f: pm },
	4102: {},
	4103: {},
	4105: {},
	4106: {},
	4107: {},
	4108: {},
	4109: { f: mm },
	4116: {},
	4117: { f: hm },
	4118: {},
	4119: { f: bm },
	4120: { f: xm },
	4121: { f: Sm },
	4122: { f: Cm },
	4123: { f: wm },
	4124: {},
	4125: { f: gm },
	4126: {},
	4127: {},
	4128: {},
	4129: {},
	4130: {},
	4132: {},
	4133: { f: _m },
	4134: { f: fa },
	4135: {},
	4146: {},
	4147: {},
	4148: {},
	4149: {},
	4154: {},
	4156: {},
	4157: {},
	4158: { f: Tm },
	4159: { f: Em },
	4160: {},
	4161: {},
	4163: {},
	4164: { f: Ko },
	4165: {},
	4166: {},
	4168: {},
	4170: {},
	4171: {},
	4174: {},
	4175: {},
	4176: {},
	4177: { f: vm },
	4187: {},
	4188: { f: Vo },
	4189: {},
	4191: {},
	4192: {},
	4193: {},
	4194: {},
	4195: {},
	4196: {},
	4197: {},
	4198: {},
	4199: {},
	4200: {},
	0: { f: co },
	1: {},
	2: { f: $o },
	3: { f: Qo },
	4: { f: Zo },
	5: { f: ts },
	7: { f: es },
	8: {},
	9: { f: Ua },
	11: {},
	22: { f: fa },
	30: { f: so },
	31: {},
	32: {},
	33: { f: ko },
	36: {},
	37: { f: $a },
	50: { f: ns },
	62: {},
	52: {},
	67: { f: ho },
	68: { f: fa },
	69: {},
	86: {},
	126: {},
	127: { f: Xo },
	135: {},
	136: {},
	137: {},
	143: { f: is },
	145: {},
	148: {},
	149: {},
	150: {},
	169: {},
	171: {},
	188: {},
	191: {},
	192: {},
	194: {},
	195: {},
	214: { f: rs },
	223: {},
	234: {},
	354: {},
	421: {},
	518: { f: Hd },
	521: { f: Ua },
	536: { f: wo },
	547: { f: Co },
	561: {},
	579: { f: go },
	1030: { f: Hd },
	1033: { f: Ua },
	1091: { f: _o },
	2157: {},
	2163: {},
	2177: {},
	2240: {},
	2241: {},
	2242: {},
	2243: {},
	2244: {},
	2245: {},
	2246: {},
	2247: {},
	2248: {},
	2249: {},
	2250: {},
	2251: {},
	2262: { r: 12 },
	101: {},
	102: {},
	105: {},
	106: {},
	107: {},
	109: {},
	112: {},
	114: {},
	29282: {}
};
function Nm(e, t, n, r) {
	var i = t;
	if (!isNaN(i)) {
		var a = r || (n || []).length || 0, o = e.next(4);
		o.write_shift(2, i), o.write_shift(2, a), a > 0 && $n(n) && e.push(n);
	}
}
function Pm(e, t) {
	var n = t || {}, r = n.dense == null ? _ : n.dense, i = {};
	r && (i["!data"] = []), e = Mt(e, "<!--", "-->");
	var a = e.match(/<table/i);
	if (!a) throw Error("Invalid HTML: could not find <table>");
	var o = e.match(/<\/table/i), s = a.index, c = o && o.index || e.length, l = Dt(e.slice(s, c), /(:?<tr[^<>]*>)/i, "<tr>"), u = -1, d = 0, f = 0, p = 0, m = {
		s: {
			r: 1e7,
			c: 1e7
		},
		e: {
			r: 0,
			c: 0
		}
	}, h = [];
	for (s = 0; s < l.length; ++s) {
		var g = l[s].trim(), v = g.slice(0, 3).toLowerCase();
		if (v == "<tr") {
			if (++u, n.sheetRows && n.sheetRows <= u) {
				--u;
				break;
			}
			d = 0;
			continue;
		}
		if (!(v != "<td" && v != "<th")) {
			var y = g.split(/<\/t[dh]>/i);
			for (c = 0; c < y.length; ++c) {
				var b = y[c].trim();
				if (b.match(/<t[dh]/i)) {
					for (var x = b, S = 0; x.charAt(0) == "<" && (S = x.indexOf(">")) > -1;) x = x.slice(S + 1);
					for (var C = 0; C < h.length; ++C) {
						var w = h[C];
						w.s.c == d && w.s.r < u && u <= w.e.r && (d = w.e.c + 1, C = -1);
					}
					var T = K(b.slice(0, b.indexOf(">")));
					p = T.colspan ? +T.colspan : 1, ((f = +T.rowspan) > 1 || p > 1) && h.push({
						s: {
							r: u,
							c: d
						},
						e: {
							r: u + (f || 1) - 1,
							c: d + p - 1
						}
					});
					var E = T.t || T["data-t"] || "";
					if (!x.length) {
						d += p;
						continue;
					}
					if (x = bn(x), m.s.r > u && (m.s.r = u), m.e.r < u && (m.e.r = u), m.s.c > d && (m.s.c = d), m.e.c < d && (m.e.c = d), !x.length) {
						d += p;
						continue;
					}
					var D = {
						t: "s",
						v: x
					};
					n.raw || !x.trim().length || E == "s" || (x === "TRUE" ? D = {
						t: "b",
						v: !0
					} : x === "FALSE" ? D = {
						t: "b",
						v: !1
					} : isNaN(vt(x)) ? isNaN(Et(x).getDate()) ? x.charCodeAt(0) == 35 && Di[x] != null && (D.t = "e", D.w = x, D.v = Di[x]) : (D = {
						t: "d",
						v: mt(x)
					}, n.UTC === !1 && (D.v = Ot(D.v)), n.cellDates || (D = {
						t: "n",
						v: ct(D.v)
					}), D.z = n.dateNF || V[14]) : D = {
						t: "n",
						v: vt(x)
					}), D.cellText !== !1 && (D.w = x), r ? (i["!data"][u] || (i["!data"][u] = []), i["!data"][u][d] = D) : i[Y({
						r: u,
						c: d
					})] = D, d += p;
				}
			}
		}
	}
	return i["!ref"] = X(m), h.length && (i["!merges"] = h), i;
}
function Fm(e) {
	return un(String(e).replace(/"/g, "'"));
}
function Im(e) {
	return e && e.rgb ? "#" + String(e.rgb).slice(-6) : "";
}
function Lm(e) {
	return e ? "'" + Fm(e).replace(/'/g, "\\'") + "'" : "";
}
function Rm(e) {
	switch (e) {
		case "dashDot":
		case "dashDotDot":
		case "dashed":
		case "mediumDashed": return "dashed";
		case "dotted":
		case "hair": return "dotted";
		case "double": return "double";
		case "none": return "none";
		default: return "solid";
	}
}
function zm(e) {
	switch (e) {
		case "medium":
		case "mediumDashDot":
		case "mediumDashDotDot":
		case "mediumDashed": return "2px";
		case "thick": return "3px";
		case "hair": return "1px";
		default: return "1px";
	}
}
function Bm(e, t, n) {
	if (!(!n || !n.style || n.style == "none")) {
		var r = Im(n.color) || "#000000";
		e.push("border-" + t + ":" + zm(n.style) + " " + Rm(n.style) + " " + r);
	}
}
function Vm(e, t) {
	if (!t || !t.cellStyles || !e || !e.s) return "";
	var n = e.s, r = [], i = n.font || {};
	i.name && r.push("font-family:" + Lm(i.name)), i.sz && r.push("font-size:" + i.sz + "pt"), i.bold && r.push("font-weight:bold"), i.italic && r.push("font-style:italic");
	var a = [];
	i.underline && a.push("underline"), i.strike && a.push("line-through"), a.length && r.push("text-decoration:" + a.join(" ")), i.color && Im(i.color) && r.push("color:" + Im(i.color));
	var o = n.fill || n, s = "";
	o.patternType != "none" && o.patternType != "gray125" && (s = Im(o.fgColor) || Im(o.bgColor)), s && r.push("background-color:" + s);
	var c = n.alignment || {};
	if (c.horizontal && r.push("text-align:" + c.horizontal), c.vertical && r.push("vertical-align:" + c.vertical), c.textRotation != null && c.textRotation !== 0) {
		var l = c.textRotation == 255 ? 90 : c.textRotation > 90 ? 90 - c.textRotation : c.textRotation;
		r.push("transform:rotate(" + l + "deg)"), r.push("transform-origin:center");
	}
	var u = n.border || {};
	return Bm(r, "left", u.left || u.start), Bm(r, "right", u.right || u.end), Bm(r, "top", u.top), Bm(r, "bottom", u.bottom), r.join(";");
}
function Hm(e, t, n, r, i) {
	if (!t || !e) return "";
	var a = e.s || {}, o = a.alignment || {}, s = [];
	if ((t.browserPixels || t.autoFit) && s.push("box-sizing:border-box;padding:0 2px;min-width:0"), o.wrapText ? s.push("white-space:pre-wrap;overflow-wrap:normal;word-break:normal") : (s.push("white-space:pre"), o.shrinkToFit || t.overflow == "clip" || t.overflow == "hidden" ? s.push("overflow:hidden;text-overflow:clip") : s.push("overflow:visible")), o.shrinkToFit && i && n != null) {
		for (var c = 0, l = r || 1, u = 0; u < l; ++u) c += Um(i[n + u]);
		var d = Ac(e, a, t);
		if (c > 0 && d > c) {
			var f = Math.max(.25, Math.min(1, c / d));
			s.push("font-size:" + Math.max(1, xc(a) * f) + "pt");
		}
	}
	return s.join(";");
}
function Um(e) {
	return yc(e);
}
function Wm(e) {
	return e ? e.hpx == null ? e.hpt == null ? 20 : Lc(e.hpt) : e.hpx : 20;
}
function Gm(e, t, n, r) {
	for (var i = e["!merges"] || [], a = [], o = {}, s = e["!data"] != null, c = (e["!rows"] || [])[n], l = r && r._htmlCols || e["!cols"] || [], u = t.s.c; u <= t.e.c; ++u) {
		for (var d = 0, f = 0, p = 0; p < i.length; ++p) if (!(i[p].s.r > n || i[p].s.c > u) && !(i[p].e.r < n || i[p].e.c < u)) {
			if (i[p].s.r < n || i[p].s.c < u) {
				d = -1;
				break;
			}
			d = i[p].e.r - i[p].s.r + 1, f = i[p].e.c - i[p].s.c + 1;
			break;
		}
		if (!(d < 0)) {
			var m = Dr(u) + Cr(n), h = s ? (e["!data"][n] || [])[u] : e[m], g = h;
			if (h && h.t == "n" && h.v != null && !isFinite(h.v) && (h = isNaN(h.v) ? {
				t: "e",
				v: 36,
				w: Ei[36]
			} : {
				t: "e",
				v: 7,
				w: Ei[7]
			}, g = h), r.cellStyles) {
				var _ = {};
				l[u] && l[u].s && nf(_, l[u].s), c && c.s && nf(_, c.s), h && h.s && nf(_, h.s), rt(_).length && (g = h ? gt(h) : { t: "z" }, g.s = _);
			}
			var v = h && h.v != null && (h.h || fn(h.w || (Ir(h), h.w) || "")) || "";
			o = {}, d > 1 && (o.rowspan = d), f > 1 && (o.colspan = f), r.editable ? v = "<span contenteditable=\"true\">" + v + "</span>" : h && (o["data-t"] = h && h.t || "z", h.v != null && (o["data-v"] = fn(h.v instanceof Date ? h.v.toISOString() : h.v)), h.z != null && (o["data-z"] = h.z), h.f != null && (o["data-f"] = fn(h.f)), h.l && (h.l.Target || "#").charAt(0) != "#" && (!r.sanitizeLinks || (h.l.Target || "").slice(0, 11).toLowerCase() != "javascript:") && (v = "<a href=\"" + fn(h.l.Target) + "\">" + v + "</a>"));
			var y = Vm(g, r), b = Hm(g, r, u, f, l);
			b && (y = y ? y + ";" + b : b), y && (o.style = y), o.id = (r.id || "sjs") + "-" + m, a.push(En("td", v, o));
		}
	}
	var x = {}, S = [];
	return c && (c.hidden && S.push("display:none"), r.browserPixels && S.push("height:" + Wm(c) + "px")), S.length && (x.style = S.join(";")), En("tr", a.join(""), x);
}
var Km = "<html><head><meta charset=\"utf-8\"/><title>SheetJS Table Export</title></head><body>", qm = "</body></html>";
function Jm(e, t) {
	var n = Rt(e, "table");
	if (!n || n.length == 0) throw Error("Invalid HTML: could not find <table>");
	if (n.length == 1) {
		var r = Lr(Pm(n[0], t), t);
		return r.bookType = "html", r;
	}
	var i = yg();
	return n.forEach(function(e, n) {
		bg(i, Pm(e, t), "Sheet" + (n + 1));
	}), i.bookType = "html", i;
}
var Ym = 9525;
function Xm(e, t, n) {
	for (var r = {
		left: 0,
		top: 0,
		width: 480,
		height: 288
	}, i = n && n._htmlCols || e["!cols"] || [], a = e["!rows"] || [], o = t && t.from || {
		col: 0,
		row: 0,
		colOff: 0,
		rowOff: 0
	}, s = t && t.to, c = 0; c < (o.col || 0); ++c) r.left += Um(i[c]);
	for (var l = 0; l < (o.row || 0); ++l) r.top += Wm(a[l]);
	if (r.left += (o.colOff || 0) / Ym, r.top += (o.rowOff || 0) / Ym, s) {
		var u = 0, d = 0;
		for (c = 0; c < (s.col || 0); ++c) u += Um(i[c]);
		for (l = 0; l < (s.row || 0); ++l) d += Wm(a[l]);
		u += (s.colOff || 0) / Ym, d += (s.rowOff || 0) / Ym, r.width = Math.max(1, u - r.left), r.height = Math.max(1, d - r.top);
	} else t && t.ext && (t.ext.cx && (r.width = t.ext.cx / Ym), t.ext.cy && (r.height = t.ext.cy / Ym));
	return r;
}
function Zm(e) {
	return "position:absolute;left:" + Math.round(e.left) + "px;top:" + Math.round(e.top) + "px;width:" + Math.round(e.width) + "px;height:" + Math.round(e.height) + "px";
}
function Qm(e) {
	return e ? e.val && e.val.values ? e.val.values : e.yVal && e.yVal.values ? e.yVal.values : e.data && e.data.length ? e.data : [] : [];
}
function $m(e) {
	return e ? e.cat && e.cat.values ? e.cat.values : e.xVal && e.xVal.values ? e.xVal.values : [] : [];
}
function eh(e, t, n) {
	var r = e && (e.model || e["!chart"] || e);
	if (!r) return "";
	var i = r.series || [], a = (r.type || "").replace(/Chart$/, ""), o = Math.max(160, Math.round(t || 480)), s = Math.max(120, Math.round(n || 288)), c = r.title || e.title || "", l = [
		"#4F81BD",
		"#C0504D",
		"#9BBB59",
		"#8064A2",
		"#4BACC6",
		"#F79646"
	], u = ["<svg class=\"sjs-chart-svg\" xmlns=\"http://www.w3.org/2000/svg\" width=\"" + o + "\" height=\"" + s + "\" viewBox=\"0 0 " + o + " " + s + "\">"];
	u.push("<rect x=\"0\" y=\"0\" width=\"" + o + "\" height=\"" + s + "\" fill=\"#fff\" stroke=\"#d0d7de\"/>"), c && u.push("<text x=\"" + o / 2 + "\" y=\"20\" text-anchor=\"middle\" font-family=\"Arial\" font-size=\"14\">" + fn(c) + "</text>");
	var d = c ? 34 : 16, f = 42, p = 14, m = 28, h = o - f - p, g = s - d - m, _ = [];
	i.forEach(function(e) {
		Qm(e).forEach(function(e) {
			typeof e == "number" && isFinite(e) && _.push(e);
		});
	});
	var v = Math.max.apply(Math, _.concat([0])), y = Math.min.apply(Math, _.concat([0]));
	if (y > 0 && (y = 0), v == y && (v = y + 1), u.push("<line x1=\"" + f + "\" y1=\"" + (d + g) + "\" x2=\"" + (f + h) + "\" y2=\"" + (d + g) + "\" stroke=\"#444\"/>"), u.push("<line x1=\"" + f + "\" y1=\"" + d + "\" x2=\"" + f + "\" y2=\"" + (d + g) + "\" stroke=\"#444\"/>"), a == "pie" || a == "doughnut") {
		var b = Qm(i[0] || {}), x = b.reduce(function(e, t) {
			return e + (typeof t == "number" ? Math.max(0, t) : 0);
		}, 0) || 1, S = o / 2, C = d + g / 2, w = Math.max(10, Math.min(h, g) / 2 - 8), T = -Math.PI / 2;
		return b.forEach(function(e, t) {
			var n = T + Math.max(0, +e || 0) / x * Math.PI * 2, r = S + w * Math.cos(T), i = C + w * Math.sin(T), a = S + w * Math.cos(n), o = C + w * Math.sin(n), s = +(n - T > Math.PI);
			u.push("<path d=\"M" + S + "," + C + " L" + r + "," + i + " A" + w + "," + w + " 0 " + s + ",1 " + a + "," + o + " Z\" fill=\"" + l[t % l.length] + "\"/>"), T = n;
		}), a == "doughnut" && u.push("<circle cx=\"" + S + "\" cy=\"" + C + "\" r=\"" + w * .45 + "\" fill=\"#fff\"/>"), u.push("</svg>"), u.join("");
	}
	var E = 0;
	if (i.forEach(function(e) {
		E = Math.max(E, Qm(e).length);
	}), !E) return u.push("</svg>"), u.join("");
	var D = h / E;
	i.forEach(function(e, t) {
		var n = Qm(e), r = l[t % l.length];
		if (a == "line" || a == "scatter" || a == "area") {
			var o = [];
			n.forEach(function(e, t) {
				if (!(typeof e != "number" || !isFinite(e))) {
					var n = f + D * (t + .5), r = d + g - (e - y) / (v - y) * g;
					o.push([n, r]);
				}
			}), a == "area" && o.length && u.push("<polygon points=\"" + [[o[0][0], d + g]].concat(o, [[o[o.length - 1][0], d + g]]).map(function(e) {
				return e[0] + "," + e[1];
			}).join(" ") + "\" fill=\"" + r + "\" opacity=\"0.35\"/>"), o.length && u.push("<polyline points=\"" + o.map(function(e) {
				return e[0] + "," + e[1];
			}).join(" ") + "\" fill=\"none\" stroke=\"" + r + "\" stroke-width=\"2\"/>"), o.forEach(function(e) {
				u.push("<circle cx=\"" + e[0] + "\" cy=\"" + e[1] + "\" r=\"2.5\" fill=\"" + r + "\"/>");
			});
		} else {
			var s = Math.max(1, D / Math.max(i.length, 1) * .72);
			n.forEach(function(e, n) {
				if (!(typeof e != "number" || !isFinite(e))) {
					var a = f + D * n + (D - s * i.length) / 2 + s * t, o = d + g - (e - y) / (v - y) * g, c = d + g - (0 - y) / (v - y) * g;
					u.push("<rect x=\"" + a + "\" y=\"" + Math.min(o, c) + "\" width=\"" + s + "\" height=\"" + Math.max(1, Math.abs(c - o)) + "\" fill=\"" + r + "\"/>");
				}
			});
		}
		e.name && u.push("<text x=\"" + (f + 8) + "\" y=\"" + (d + 14 + t * 14) + "\" font-family=\"Arial\" font-size=\"11\" fill=\"" + r + "\">" + fn(e.name) + "</text>");
	});
	var O = $m(i[0] || {});
	return O.slice(0, Math.min(O.length, E)).forEach(function(e, t) {
		t % Math.ceil(E / 8) == 0 && u.push("<text x=\"" + (f + D * (t + .5)) + "\" y=\"" + (d + g + 16) + "\" text-anchor=\"middle\" font-family=\"Arial\" font-size=\"10\">" + fn(String(e)) + "</text>");
	}), u.push("</svg>"), u.join("");
}
function th(e, t) {
	var n = [], r = e["!drawings"] || {}, i = e["!charts"] || [];
	return t && t.drawings && r.images && r.images.forEach(function(r) {
		if (!(!r || !r.dataURI)) {
			var i = Xm(e, r.anchor, t);
			n.push("<img class=\"sjs-drawing-image\" src=\"" + r.dataURI + "\" style=\"" + Zm(i) + "\"/>");
		}
	}), t && t.charts && i.forEach(function(r) {
		var i = Xm(e, r.anchor, t);
		n.push("<div class=\"sjs-chart\" style=\"" + Zm(i) + "\">" + eh(r, i.width, i.height) + "</div>");
	}), n.length ? "<div class=\"sjs-drawing-layer\" style=\"position:absolute;left:0;top:0;pointer-events:none\">" + n.join("") + "</div>" : "";
}
function nh(e, t, n) {
	var r = [], i = {}, a = [];
	n && n.id && (i.id = n.id), n && (n.browserPixels || n.autoFit) && a.push("border-collapse:collapse;table-layout:fixed"), a.length && (i.style = a.join(";"));
	var o = En("table", "", i).replace(/<\/table>$/, ""), s = n && n._htmlCols || e["!cols"];
	if (n && (n.browserPixels || n.autoFit) && s) {
		r.push("<colgroup>");
		for (var c = t.s.c; c <= t.e.c; ++c) {
			var l = s[c], u = [];
			u.push("width:" + Um(l) + "px"), l && l.hidden && u.push("display:none"), r.push(En("col", null, { style: u.join(";") }));
		}
		r.push("</colgroup>");
	}
	return o + r.join("");
}
function rh(e, t) {
	var n = {};
	if (t) for (var r in t) Object.prototype.hasOwnProperty.call(t, r) && (n[r] = t[r]);
	if (n.autoFit) {
		var i = { set: !1 };
		if (typeof n.autoFit == "object") for (r in n.autoFit) Object.prototype.hasOwnProperty.call(n.autoFit, r) && (i[r] = n.autoFit[r]);
		n.measureText && i.measureText == null && (i.measureText = n.measureText), n.canvas && i.canvas == null && (i.canvas = n.canvas), n._htmlCols = Nc(e, i), n.browserPixels == null && (n.browserPixels = !0);
	}
	var a = n.header == null ? Km : n.header, o = n.footer == null ? qm : n.footer, s = [a], c = Mr(e["!ref"] || "A1"), l = n.charts && e["!charts"] && e["!charts"].length || n.drawings && e["!drawings"];
	if (l && s.push("<div class=\"sjs-sheet\" style=\"position:relative;display:inline-block\">"), s.push(nh(e, c, n)), e["!ref"]) for (var u = c.s.r; u <= c.e.r; ++u) s.push(Gm(e, c, u, n));
	return l ? (s.push("</table>"), s.push(th(e, n)), s.push("</div>"), s.push(o)) : s.push("</table>" + o), s.join("");
}
function ih(e, t, n) {
	var r = n || {}, i = e["!data"] != null, a = 0, o = 0;
	if (r.origin != null) if (typeof r.origin == "number") a = r.origin;
	else {
		var s = typeof r.origin == "string" ? jr(r.origin) : r.origin;
		a = s.r, o = s.c;
	}
	var c = {
		s: {
			r: 0,
			c: 0
		},
		e: {
			r: a,
			c: o
		}
	};
	if (e["!ref"]) {
		var l = Mr(e["!ref"]);
		c.s.r = Math.min(c.s.r, l.s.r), c.s.c = Math.min(c.s.c, l.s.c), c.e.r = Math.max(c.e.r, l.e.r), c.e.c = Math.max(c.e.c, l.e.c), a == -1 && (c.e.r = a = l.e.r + 1);
	}
	var u = t.rows;
	if (!u) throw "Unsupported origin when " + t.tagName + " is not a TABLE";
	var d = Math.min(r.sheetRows || 1e7, u.length), f = [], p = 0, m = e["!rows"] || (e["!rows"] = []), h = 0, g = 0, _ = 0, v = 0, y = 0, b = 0;
	for (e["!cols"] || (e["!cols"] = []); h < u.length && g < d; ++h) {
		var x = u[h];
		if (sh(x)) {
			if (r.display) continue;
			m[g] = { hidden: !0 };
		}
		var S = x.cells;
		for (_ = v = 0; _ < S.length; ++_) {
			var C = S[_];
			if (!(r.display && sh(C))) {
				var w = C.hasAttribute("data-v") ? C.getAttribute("data-v") : C.hasAttribute("v") ? C.getAttribute("v") : bn(C.innerHTML), T = C.getAttribute("data-z") || C.getAttribute("z"), E = C.hasAttribute("data-f") ? C.getAttribute("data-f") : C.hasAttribute("f") ? C.getAttribute("f") : null;
				for (p = 0; p < f.length; ++p) {
					var D = f[p];
					D.s.c == v + o && D.s.r < g + a && g + a <= D.e.r && (v = D.e.c + 1 - o, p = -1);
				}
				b = +C.getAttribute("colspan") || 1, ((y = +C.getAttribute("rowspan") || 1) > 1 || b > 1) && f.push({
					s: {
						r: g + a,
						c: v + o
					},
					e: {
						r: g + a + (y || 1) - 1,
						c: v + o + (b || 1) - 1
					}
				});
				var O = {
					t: "s",
					v: w
				}, k = C.getAttribute("data-t") || C.getAttribute("t") || "";
				w != null && (w.length == 0 ? O.t = k || "z" : r.raw || w.trim().length == 0 || k == "s" || (k == "e" && Ei[+w] ? O = {
					t: "e",
					v: +w,
					w: Ei[+w]
				} : w === "TRUE" ? O = {
					t: "b",
					v: !0
				} : w === "FALSE" ? O = {
					t: "b",
					v: !1
				} : isNaN(vt(w)) ? isNaN(Et(w).getDate()) ? w.charCodeAt(0) == 35 && Di[w] != null && (O = {
					t: "e",
					v: Di[w],
					w
				}) : (O = {
					t: "d",
					v: mt(w)
				}, r.UTC && (O.v = kt(O.v)), r.cellDates || (O = {
					t: "n",
					v: ct(O.v)
				}), O.z = r.dateNF || V[14]) : O = {
					t: "n",
					v: vt(w)
				})), O.z === void 0 && T != null && (O.z = T);
				var A = "", j = C.getElementsByTagName("A");
				if (j && j.length) for (var ee = 0; ee < j.length && !(j[ee].hasAttribute("href") && (A = j[ee].getAttribute("href"), A.charAt(0) != "#")); ++ee);
				A && A.charAt(0) != "#" && A.slice(0, 11).toLowerCase() != "javascript:" && (O.l = { Target: A }), E != null && (O.f = E), i ? (e["!data"][g + a] || (e["!data"][g + a] = []), e["!data"][g + a][v + o] = O) : e[Y({
					c: v + o,
					r: g + a
				})] = O, c.e.c < v + o && (c.e.c = v + o), v += b;
			}
		}
		++g;
	}
	return f.length && (e["!merges"] = (e["!merges"] || []).concat(f)), c.e.r = Math.max(c.e.r, g - 1 + a), e["!ref"] = X(c), g >= d && (e["!fullref"] = X((c.e.r = u.length - h + g - 1 + a, c))), e;
}
function ah(e, t) {
	var n = t || {}, r = {};
	return n.dense && (r["!data"] = []), ih(r, e, t);
}
function oh(e, t) {
	return Lr(ah(e, t), t);
}
function sh(e) {
	var t = "", n = ch(e);
	return n && (t = n(e).getPropertyValue("display")), t || (t = e.style && e.style.display), t === "none";
}
function ch(e) {
	return e.ownerDocument.defaultView && typeof e.ownerDocument.defaultView.getComputedStyle == "function" ? e.ownerDocument.defaultView.getComputedStyle : typeof getComputedStyle == "function" ? getComputedStyle : null;
}
function lh(e) {
	return [q(e.replace(/[\t\r\n]/g, " ").trim().replace(/ +/g, " ").replace(/<text:s\/>/g, " ").replace(/<text:s text:c="(\d+)"\/>/g, function(e, t) {
		return Array(parseInt(t, 10) + 1).join(" ");
	}).replace(/<text:tab[^<>]*\/>/g, "	").replace(/<text:line-break\/>/g, "\n").replace(/<[^<>]*>/g, ""))];
}
function uh(e, t, n) {
	var r = n || {}, i = Dn(e);
	On.lastIndex = 0, i = At(Mt(i, "<!--", "-->"));
	for (var a, o, s = "", c = "", l, u = 0, d = -1, f = ""; a = On.exec(i);) switch (a[3] = a[3].replace(/_[\s\S]*$/, "")) {
		case "number-style":
		case "currency-style":
		case "percentage-style":
		case "date-style":
		case "time-style":
		case "text-style":
			a[1] === "/" ? (o["truncate-on-overflow"] == "false" && (s.match(/h/) ? s = s.replace(/h+/, "[$&]") : s.match(/m/) ? s = s.replace(/m+/, "[$&]") : s.match(/s/) && (s = s.replace(/s+/, "[$&]"))), r[o.name] = s, s = "") : a[0].charAt(a[0].length - 2) !== "/" && (s = "", o = K(a[0], !1));
			break;
		case "boolean-style":
			a[1] === "/" ? (r[o.name] = "General", s = "") : a[0].charAt(a[0].length - 2) !== "/" && (s = "", o = K(a[0], !1));
			break;
		case "boolean":
			s += "General";
			break;
		case "text":
			a[1] === "/" ? (f = i.slice(d, On.lastIndex - a[0].length), f == "%" && o[0] == "<number:percentage-style" ? s += "%" : s += "\"" + f.replace(/"/g, "\"\"") + "\"") : a[0].charAt(a[0].length - 2) !== "/" && (d = On.lastIndex);
			break;
		case "day":
			switch (l = K(a[0], !1), l.style) {
				case "short":
					s += "d";
					break;
				case "long":
					s += "dd";
					break;
				default:
					s += "dd";
					break;
			}
			break;
		case "day-of-week":
			switch (l = K(a[0], !1), l.style) {
				case "short":
					s += "ddd";
					break;
				case "long":
					s += "dddd";
					break;
				default:
					s += "ddd";
					break;
			}
			break;
		case "era":
			switch (l = K(a[0], !1), l.style) {
				case "short":
					s += "ee";
					break;
				case "long":
					s += "eeee";
					break;
				default:
					s += "eeee";
					break;
			}
			break;
		case "hours":
			switch (l = K(a[0], !1), l.style) {
				case "short":
					s += "h";
					break;
				case "long":
					s += "hh";
					break;
				default:
					s += "hh";
					break;
			}
			break;
		case "minutes":
			switch (l = K(a[0], !1), l.style) {
				case "short":
					s += "m";
					break;
				case "long":
					s += "mm";
					break;
				default:
					s += "mm";
					break;
			}
			break;
		case "month":
			switch (l = K(a[0], !1), l.textual && (s += "mm"), l.style) {
				case "short":
					s += "m";
					break;
				case "long":
					s += "mm";
					break;
				default:
					s += "m";
					break;
			}
			break;
		case "seconds":
			switch (l = K(a[0], !1), l.style) {
				case "short":
					s += "s";
					break;
				case "long":
					s += "ss";
					break;
				default:
					s += "ss";
					break;
			}
			l["decimal-places"] && (s += "." + _t("0", +l["decimal-places"]));
			break;
		case "year":
			switch (l = K(a[0], !1), l.style) {
				case "short":
					s += "yy";
					break;
				case "long":
					s += "yyyy";
					break;
				default:
					s += "yy";
					break;
			}
			break;
		case "am-pm":
			s += "AM/PM";
			break;
		case "week-of-year":
		case "quarter":
			console.error("Excel does not support ODS format token " + a[3]);
			break;
		case "fill-character":
			a[1] === "/" ? (f = i.slice(d, On.lastIndex - a[0].length), s += "\"" + f.replace(/"/g, "\"\"") + "\"*") : a[0].charAt(a[0].length - 2) !== "/" && (d = On.lastIndex);
			break;
		case "scientific-number":
			l = K(a[0], !1), s += "0." + _t("0", +l["min-decimal-places"] || +l["decimal-places"] || 2) + _t("?", l["decimal-places"] - +l["min-decimal-places"] || 0) + "E" + (J(l["forced-exponent-sign"]) ? "+" : "") + _t("0", +l["min-exponent-digits"] || 2);
			break;
		case "fraction":
			l = K(a[0], !1), +l["min-integer-digits"] ? s += _t("0", +l["min-integer-digits"]) : s += "#", s += " ", s += _t("?", +l["min-numerator-digits"] || 1), s += "/", +l["denominator-value"] ? s += l["denominator-value"] : s += _t("?", +l["min-denominator-digits"] || 1);
			break;
		case "currency-symbol":
			a[1] === "/" ? s += "\"" + i.slice(d, On.lastIndex - a[0].length).replace(/"/g, "\"\"") + "\"" : a[0].charAt(a[0].length - 2) === "/" ? s += "$" : d = On.lastIndex;
			break;
		case "text-properties":
			switch (l = K(a[0], !1), (l.color || "").toLowerCase().replace("#", "")) {
				case "ff0000":
				case "red":
					s = "[Red]" + s;
					break;
			}
			break;
		case "text-content":
			s += "@";
			break;
		case "map":
			l = K(a[0], !1), q(l.condition) == "value()>=0" ? s = r[l["apply-style-name"]] + ";" + s : t && t.WTF && console.error("ODS number format may be incorrect: " + l.condition);
			break;
		case "number":
			if (a[1] === "/") break;
			l = K(a[0], !1), c = "", c += _t("0", +l["min-integer-digits"] || 1), J(l.grouping) && (c = ge(_t("#", Math.max(0, 4 - c.length)) + c)), (+l["min-decimal-places"] || +l["decimal-places"]) && (c += "."), +l["min-decimal-places"] && (c += _t("0", +l["min-decimal-places"] || 1)), l["decimal-places"] - (+l["min-decimal-places"] || 0) && (c += _t("0", l["decimal-places"] - (+l["min-decimal-places"] || 0))), s += c;
			break;
		case "embedded-text":
			a[1] === "/" ? u == 0 ? s += "\"" + i.slice(d, On.lastIndex - a[0].length).replace(/"/g, "\"\"") + "\"" : s = s.slice(0, u) + "\"" + i.slice(d, On.lastIndex - a[0].length).replace(/"/g, "\"\"") + "\"" + s.slice(u) : a[0].charAt(a[0].length - 2) !== "/" && (d = On.lastIndex, u = -+K(a[0], !1).position || 0);
			break;
	}
	return r;
}
function dh(e, t, n) {
	var r = t || {};
	_ != null && r.dense == null && (r.dense = _);
	var i = Dn(e), a = [], o, s, c, l = "", u = 0, d, f, p = {}, m = [], h = {};
	r.dense && (h["!data"] = []);
	var g, v, y = { value: "" }, b = {}, x = "", S = 0, C, w = "", T = 0, E = [], D = [], O = -1, k = -1, A = {
		s: {
			r: 1e6,
			c: 1e7
		},
		e: {
			r: 0,
			c: 0
		}
	}, j = 0, ee = n || {}, M = {}, N = {}, P = [], F = {}, I = 0, L = 0, te = [], ne = 1, re = 1, R = [], z = {
		Names: [],
		WBProps: {},
		Sheets: []
	}, B = {}, ie = ["", ""], ae = [], V = {}, oe = "", se = 0, ce = !1, le = !1, H = 0;
	for (On.lastIndex = 0, i = At(Mt(i, "<!--", "-->")); g = On.exec(i);) switch (g[3] = g[3].replace(/_[\s\S]*$/, "")) {
		case "table":
		case "工作表":
			g[1] === "/" ? (A.e.c >= A.s.c && A.e.r >= A.s.r ? h["!ref"] = X(A) : h["!ref"] = "A1:A1", r.sheetRows > 0 && r.sheetRows <= A.e.r && (h["!fullref"] = h["!ref"], A.e.r = r.sheetRows - 1, h["!ref"] = X(A)), P.length && (h["!merges"] = P), te.length && (h["!rows"] = te), d.name = d.名称 || d.name, typeof JSON < "u" && JSON.stringify(d), m.push(d.name), p[d.name] = h, z.Sheets.push({ Hidden: N[d["style-name"]] && N[d["style-name"]].display ? +!J(N[d["style-name"]].display) : 0 }), le = !1) : g[0].charAt(g[0].length - 2) !== "/" && (d = K(g[0], !1), O = k = -1, A.s.r = A.s.c = 1e7, A.e.r = A.e.c = 0, h = {}, r.dense && (h["!data"] = []), P = [], te = [], le = !0);
			break;
		case "table-row-group":
			g[1] === "/" ? --j : ++j;
			break;
		case "table-row":
		case "行":
			if (g[1] === "/") {
				O += ne, ne = 1;
				break;
			}
			if (f = K(g[0], !1), f.行号 ? O = f.行号 - 1 : O == -1 && (O = 0), ne = +f["number-rows-repeated"] || 1, ne < 10) for (H = 0; H < ne; ++H) j > 0 && (te[O + H] = { level: j });
			k = -1;
			break;
		case "covered-table-cell":
			if (g[1] !== "/") if (++k, y = K(g[0], !1), re = parseInt(y["number-columns-repeated"] || "1", 10) || 1, r.sheetStubs) {
				for (; re-- > 0;) r.dense ? (h["!data"][O] || (h["!data"][O] = []), h["!data"][O][k] = { t: "z" }) : h[Y({
					r: O,
					c: k
				})] = { t: "z" }, ++k;
				--k;
			} else k += re - 1;
			x = "", E = [];
			break;
		case "table-cell":
		case "数据":
			if (g[0].charAt(g[0].length - 2) === "/") ++k, y = K(g[0], !1), re = parseInt(y["number-columns-repeated"] || "1", 10) || 1, v = {
				t: "z",
				v: null
			}, y.formula && r.cellFormula != 0 && (v.f = Zd(q(y.formula))), y["style-name"] && M[y["style-name"]] && (v.z = M[y["style-name"]]), (y.数据类型 || y["value-type"]) == "string" && (v.t = "s", v.v = q(y["string-value"] || ""), r.dense ? (h["!data"][O] || (h["!data"][O] = []), h["!data"][O][k] = v) : h[Dr(k) + Cr(O)] = v), k += re - 1;
			else if (g[1] !== "/") {
				++k, x = w = "", S = T = 0, E = [], D = [], re = 1;
				var ue = ne ? O + ne - 1 : O;
				if (k > A.e.c && (A.e.c = k), k < A.s.c && (A.s.c = k), O < A.s.r && (A.s.r = O), ue > A.e.r && (A.e.r = ue), y = K(g[0], !1), b = rn(g[0], !0), ae = [], V = {}, v = {
					t: y.数据类型 || y["value-type"],
					v: null
				}, y["style-name"] && M[y["style-name"]] && (v.z = M[y["style-name"]]), r.cellFormula) if (y.formula && (y.formula = q(y.formula)), y["number-matrix-columns-spanned"] && y["number-matrix-rows-spanned"] && (I = parseInt(y["number-matrix-rows-spanned"], 10) || 0, L = parseInt(y["number-matrix-columns-spanned"], 10) || 0, F = {
					s: {
						r: O,
						c: k
					},
					e: {
						r: O + I - 1,
						c: k + L - 1
					}
				}, v.F = X(F), R.push([F, v.F])), y.formula) v.f = Zd(y.formula);
				else for (H = 0; H < R.length; ++H) O >= R[H][0].s.r && O <= R[H][0].e.r && k >= R[H][0].s.c && k <= R[H][0].e.c && (v.F = R[H][1]);
				switch ((y["number-columns-spanned"] || y["number-rows-spanned"]) && (I = parseInt(y["number-rows-spanned"] || "1", 10) || 1, L = parseInt(y["number-columns-spanned"] || "1", 10) || 1, I * L > 1 && (F = {
					s: {
						r: O,
						c: k
					},
					e: {
						r: O + I - 1,
						c: k + L - 1
					}
				}, P.push(F))), y["number-columns-repeated"] && (re = parseInt(y["number-columns-repeated"], 10)), v.t) {
					case "boolean":
						v.t = "b", v.v = J(y["boolean-value"]) || +y["boolean-value"] >= 1;
						break;
					case "float":
						v.t = "n", v.v = parseFloat(y.value), r.cellDates && v.z && ze(v.z) && (v.v = lt(v.v + (z.WBProps.date1904 ? 1462 : 0)), v.t = typeof v.v == "number" ? "n" : "d");
						break;
					case "percentage":
						v.t = "n", v.v = parseFloat(y.value);
						break;
					case "currency":
						v.t = "n", v.v = parseFloat(y.value);
						break;
					case "date":
						v.t = "d", v.v = mt(y["date-value"], z.WBProps.date1904), r.cellDates || (v.t = "n", v.v = ct(v.v, z.WBProps.date1904)), v.z || (v.z = "m/d/yy");
						break;
					case "time":
						v.t = "n", v.v = ut(y["time-value"]) / 86400, r.cellDates && (v.v = lt(v.v), v.t = typeof v.v == "number" ? "n" : "d"), v.z || (v.z = "HH:MM:SS");
						break;
					case "number":
						v.t = "n", v.v = parseFloat(y.数据数值);
						break;
					default: if (v.t === "string" || v.t === "text" || !v.t) v.t = "s", y["string-value"] != null && (x = q(y["string-value"]), E = []);
					else throw Error("Unsupported value type " + v.t);
				}
			} else {
				if (ce = !1, b["calcext:value-type"] == "error" && Di[x] != null && (v.t = "e", v.w = x, v.v = Di[x]), v.t === "s" && (v.v = x || "", E.length && (v.R = E), ce = S == 0), B.Target && (v.l = B), ae.length > 0 && (v.c = ae, ae = []), x && r.cellText !== !1 && (v.w = x), ce && (v.t = "z", delete v.v), (!ce || r.sheetStubs) && !(r.sheetRows && r.sheetRows <= O)) for (var U = 0; U < ne; ++U) {
					if (re = parseInt(y["number-columns-repeated"] || "1", 10), r.dense) for (h["!data"][O + U] || (h["!data"][O + U] = []), h["!data"][O + U][k] = U == 0 ? v : gt(v); --re > 0;) h["!data"][O + U][k + re] = gt(v);
					else for (h[Y({
						r: O + U,
						c: k
					})] = v; --re > 0;) h[Y({
						r: O + U,
						c: k + re
					})] = gt(v);
					A.e.c <= k && (A.e.c = k);
				}
				re = parseInt(y["number-columns-repeated"] || "1", 10), k += re - 1, re = 0, v = {}, x = "", E = [];
			}
			B = {};
			break;
		case "document":
		case "document-content":
		case "电子表格文档":
		case "spreadsheet":
		case "主体":
		case "scripts":
		case "styles":
		case "font-face-decls":
		case "master-styles":
			if (g[1] === "/") {
				if ((o = a.pop())[0] !== g[3]) throw "Bad state: " + o;
			} else g[0].charAt(g[0].length - 2) !== "/" && a.push([g[3], !0]);
			break;
		case "annotation":
			if (g[1] === "/") {
				if ((o = a.pop())[0] !== g[3]) throw "Bad state: " + o;
				V.t = x, E.length && (V.R = E), V.a = oe, ae.push(V), x = w, S = T, E = D;
			} else if (g[0].charAt(g[0].length - 2) !== "/") {
				a.push([g[3], !1]);
				var W = K(g[0], !0);
				W.display && J(W.display) || (ae.hidden = !0), w = x, T = S, D = E, x = "", S = 0, E = [];
			}
			oe = "", se = 0;
			break;
		case "creator":
			g[1] === "/" ? oe = i.slice(se, g.index) : se = g.index + g[0].length;
			break;
		case "meta":
		case "元数据":
		case "settings":
		case "config-item-set":
		case "config-item-map-indexed":
		case "config-item-map-entry":
		case "config-item-map-named":
		case "shapes":
		case "frame":
		case "text-box":
		case "image":
		case "data-pilot-tables":
		case "list-style":
		case "form":
		case "dde-links":
		case "event-listeners":
		case "chart":
			if (g[1] === "/") {
				if ((o = a.pop())[0] !== g[3]) throw "Bad state: " + o;
			} else g[0].charAt(g[0].length - 2) !== "/" && a.push([g[3], !1]);
			x = "", S = 0, E = [];
			break;
		case "scientific-number":
		case "currency-symbol":
		case "fill-character": break;
		case "text-style":
		case "boolean-style":
		case "number-style":
		case "currency-style":
		case "percentage-style":
		case "date-style":
		case "time-style":
			if (g[1] === "/") {
				var de = On.lastIndex;
				uh(i.slice(c, On.lastIndex), t, ee), On.lastIndex = de;
			} else g[0].charAt(g[0].length - 2) !== "/" && (c = On.lastIndex - g[0].length);
			break;
		case "script": break;
		case "libraries": break;
		case "automatic-styles": break;
		case "default-style":
		case "page-layout": break;
		case "style":
			var fe = K(g[0], !1);
			fe.family == "table-cell" && ee[fe["data-style-name"]] ? M[fe.name] = ee[fe["data-style-name"]] : fe.family == "table" && (N[fe.name] = fe);
			break;
		case "map": break;
		case "font-face": break;
		case "paragraph-properties": break;
		case "table-properties":
			var pe = K(g[0], !1);
			fe && fe.family == "table" && (fe.display = pe.display);
			break;
		case "table-column-properties": break;
		case "table-row-properties": break;
		case "table-cell-properties": break;
		case "number": break;
		case "fraction": break;
		case "day":
		case "month":
		case "year":
		case "era":
		case "day-of-week":
		case "week-of-year":
		case "quarter":
		case "hours":
		case "minutes":
		case "seconds":
		case "am-pm": break;
		case "boolean": break;
		case "text":
			if (g[0].slice(-2) === "/>") break;
			if (g[1] === "/") switch (a[a.length - 1][0]) {
				case "number-style":
				case "date-style":
				case "time-style":
					l += i.slice(u, g.index);
					break;
			}
			else u = g.index + g[0].length;
			break;
		case "named-range":
			s = K(g[0], !1), ie = Qd(s["cell-range-address"]);
			var me = {
				Name: s.name,
				Ref: ie[0] + "!" + ie[1]
			};
			le && (me.Sheet = m.length), z.Names.push(me);
			break;
		case "text-content": break;
		case "text-properties": break;
		case "embedded-text": break;
		case "body":
		case "电子表格": break;
		case "forms": break;
		case "table-column": break;
		case "table-header-rows": break;
		case "table-rows": break;
		case "table-column-group": break;
		case "table-header-columns": break;
		case "table-columns": break;
		case "null-date":
			switch (s = K(g[0], !1), s["date-value"]) {
				case "1904-01-01":
					z.WBProps.date1904 = !0;
					break;
			}
			break;
		case "graphic-properties": break;
		case "calculation-settings": break;
		case "named-expressions": break;
		case "label-range": break;
		case "label-ranges": break;
		case "named-expression": break;
		case "sort": break;
		case "sort-by": break;
		case "sort-groups": break;
		case "tab": break;
		case "line-break": break;
		case "span": break;
		case "p":
		case "文本串":
			if (["master-styles"].indexOf(a[a.length - 1][0]) > -1) break;
			if (g[1] === "/" && (!y || !y["string-value"])) {
				var he = lh(i.slice(S, g.index), C);
				x = (x.length > 0 ? x + "\n" : "") + he[0];
			} else g[0].slice(-2) == "/>" ? x += "\n" : (C = K(g[0], !1), S = g.index + g[0].length);
			break;
		case "s": break;
		case "database-range":
			if (g[1] === "/") break;
			try {
				ie = Qd(K(g[0])["target-range-address"]), p[ie[0]]["!autofilter"] = { ref: ie[1] };
			} catch {}
			break;
		case "date": break;
		case "object": break;
		case "title":
		case "标题": break;
		case "desc": break;
		case "binary-data": break;
		case "table-source": break;
		case "scenario": break;
		case "iteration": break;
		case "content-validations": break;
		case "content-validation": break;
		case "help-message": break;
		case "error-message": break;
		case "database-ranges": break;
		case "filter": break;
		case "filter-and": break;
		case "filter-or": break;
		case "filter-condition": break;
		case "filter-set-item": break;
		case "list-level-style-bullet": break;
		case "list-level-style-number": break;
		case "list-level-properties": break;
		case "sender-firstname":
		case "sender-lastname":
		case "sender-initials":
		case "sender-title":
		case "sender-position":
		case "sender-email":
		case "sender-phone-private":
		case "sender-fax":
		case "sender-company":
		case "sender-phone-work":
		case "sender-street":
		case "sender-city":
		case "sender-postal-code":
		case "sender-country":
		case "sender-state-or-province":
		case "author-name":
		case "author-initials":
		case "chapter":
		case "file-name":
		case "template-name":
		case "sheet-name": break;
		case "event-listener": break;
		case "initial-creator":
		case "creation-date":
		case "print-date":
		case "generator":
		case "document-statistic":
		case "user-defined":
		case "editing-duration":
		case "editing-cycles": break;
		case "config-item": break;
		case "page-number": break;
		case "page-count": break;
		case "time": break;
		case "cell-range-source": break;
		case "detective": break;
		case "operation": break;
		case "highlighted-range": break;
		case "data-pilot-table":
		case "source-cell-range":
		case "source-service":
		case "data-pilot-field":
		case "data-pilot-level":
		case "data-pilot-subtotals":
		case "data-pilot-subtotal":
		case "data-pilot-members":
		case "data-pilot-member":
		case "data-pilot-display-info":
		case "data-pilot-sort-info":
		case "data-pilot-layout-info":
		case "data-pilot-field-reference":
		case "data-pilot-groups":
		case "data-pilot-group":
		case "data-pilot-group-member": break;
		case "rect": break;
		case "dde-connection-decls":
		case "dde-connection-decl":
		case "dde-link":
		case "dde-source": break;
		case "properties": break;
		case "property": break;
		case "a":
			if (g[1] !== "/") {
				if (B = K(g[0], !1), !B.href) break;
				B.Target = q(B.href), delete B.href, B.Target.charAt(0) == "#" && B.Target.indexOf(".") > -1 ? (ie = Qd(B.Target.slice(1)), B.Target = "#" + ie[0] + "!" + ie[1]) : B.Target.match(/^\.\.[\\\/]/) && (B.Target = B.Target.slice(3)), B.title && (B.Tooltip = q(B.title), delete B.title);
			}
			break;
		case "table-protection": break;
		case "data-pilot-grand-total": break;
		case "office-document-common-attrs": break;
		default: switch (g[2]) {
			case "dc:":
			case "calcext:":
			case "loext:":
			case "ooo:":
			case "chartooo:":
			case "draw:":
			case "style:":
			case "chart:":
			case "form:":
			case "uof:":
			case "表:":
			case "字:": break;
			default: if (r.WTF) throw Error(g);
		}
	}
	var ge = {
		Sheets: p,
		SheetNames: m,
		Workbook: z
	};
	return r.bookSheets && delete ge.Sheets, ge;
}
function fh(e, t) {
	t = t || {}, Ht(e, "META-INF/manifest.xml") && Ii(Wt(e, "META-INF/manifest.xml"), t);
	var n = Gt(e, "styles.xml"), r = n && uh(vn(n), t), i = Gt(e, "content.xml");
	if (!i) throw Error("Missing content.xml in ODS / UOF file");
	var a = dh(vn(i), t, r);
	return Ht(e, "meta.xml") && (a.Props = Ri(Wt(e, "meta.xml"))), a.bookType = "ods", a;
}
function ph(e, t) {
	var n = dh(e, t);
	return n.bookType = "fods", n;
}
var mh = function() {
	try {
		return typeof Uint8Array > "u" || Uint8Array.prototype.subarray === void 0 ? "slice" : typeof Buffer < "u" ? Buffer.prototype.subarray === void 0 ? "slice" : (typeof Buffer.from == "function" ? Buffer.from([72, 62]) : new Buffer([72, 62])) instanceof Uint8Array ? "subarray" : "slice" : "subarray";
	} catch {
		return "slice";
	}
}();
function hh(e) {
	return new DataView(e.buffer, e.byteOffset, e.byteLength);
}
function gh(e) {
	return typeof TextDecoder < "u" ? new TextDecoder().decode(e) : vn(k(e));
}
function _h(e) {
	for (var t = 0, n = 0; n < e.length; ++n) t += e[n].length;
	var r = new Uint8Array(t), i = 0;
	for (n = 0; n < e.length; ++n) {
		var a = e[n], o = a.length;
		if (o < 250) for (var s = 0; s < o; ++s) r[i++] = a[s];
		else r.set(a, i), i += o;
	}
	return r;
}
function vh(e) {
	return e -= e >> 1 & 1431655765, e = (e & 858993459) + (e >> 2 & 858993459), (e + (e >> 4) & 252645135) * 16843009 >>> 24;
}
function yh(e, t) {
	for (var n = (e[t + 15] & 127) << 7 | e[t + 14] >> 1, r = e[t + 14] & 1, i = t + 13; i >= t; --i) r = r * 256 + e[i];
	return (e[t + 15] & 128 ? -r : r) * 10 ** (n - 6176);
}
function bh(e, t) {
	var n = t.l, r = e[n] & 127;
	varint: if (e[n++] >= 128 && (r |= (e[n] & 127) << 7, e[n++] < 128 || (r |= (e[n] & 127) << 14, e[n++] < 128) || (r |= (e[n] & 127) << 21, e[n++] < 128) || (r += (e[n] & 127) * 2 ** 28, ++n, e[n++] < 128) || (r += (e[n] & 127) * 2 ** 35, ++n, e[n++] < 128) || (r += (e[n] & 127) * 2 ** 42, ++n, e[n++] < 128))) break varint;
	return t.l = n, r;
}
function xh(e) {
	var t = 0, n = e[t] & 127;
	return e[t++] < 128 || (n |= (e[t] & 127) << 7, e[t++] < 128) || (n |= (e[t] & 127) << 14, e[t++] < 128) || (n |= (e[t] & 127) << 21, e[t++] < 128) || (n |= (e[t] & 15) << 28), n;
}
function Z(e) {
	for (var t = [], n = { l: 0 }; n.l < e.length;) {
		var r = n.l, i = bh(e, n), a = i & 7;
		i = i / 8 | 0;
		var o, s = n.l;
		switch (a) {
			case 0:
				for (; e[s++] >= 128;);
				o = e[mh](n.l, s), n.l = s;
				break;
			case 1:
				o = e[mh](s, s + 8), n.l = s + 8;
				break;
			case 2:
				var c = bh(e, n);
				o = e[mh](n.l, n.l + c), n.l += c;
				break;
			case 5:
				o = e[mh](s, s + 4), n.l = s + 4;
				break;
			default: throw Error(`PB Type ${a} for Field ${i} at offset ${r}`);
		}
		var l = {
			data: o,
			type: a
		};
		t[i] == null && (t[i] = []), t[i].push(l);
	}
	return t;
}
function Sh(e, t) {
	return (e == null ? void 0 : e.map(function(e) {
		return t(e.data);
	})) || [];
}
function Ch(e) {
	for (var t, n = [], r = { l: 0 }; r.l < e.length;) {
		var i = bh(e, r), a = Z(e[mh](r.l, r.l + i));
		r.l += i;
		var o = {
			id: xh(a[1][0].data),
			messages: []
		};
		a[2].forEach(function(t) {
			var n = Z(t.data), i = xh(n[3][0].data);
			o.messages.push({
				meta: n,
				data: e[mh](r.l, r.l + i)
			}), r.l += i;
		}), (t = a[3]) != null && t[0] && (o.merge = xh(a[3][0].data) >>> 0 > 0), n.push(o);
	}
	return n;
}
function wh(e, t) {
	if (e != 0) throw Error(`Unexpected Snappy chunk type ${e}`);
	for (var n = { l: 0 }, r = bh(t, n), i = [], a = n.l; a < t.length;) {
		var o = t[a] & 3;
		if (o == 0) {
			var s = t[a++] >> 2;
			if (s < 60) ++s;
			else {
				var c = s - 59;
				s = t[a], c > 1 && (s |= t[a + 1] << 8), c > 2 && (s |= t[a + 2] << 16), c > 3 && (s |= t[a + 3] << 24), s >>>= 0, s++, a += c;
			}
			i.push(t[mh](a, a + s)), a += s;
			continue;
		} else {
			var l = 0, u = 0;
			if (o == 1 ? (u = (t[a] >> 2 & 7) + 4, l = (t[a++] & 224) << 3, l |= t[a++]) : (u = (t[a++] >> 2) + 1, o == 2 ? (l = t[a] | t[a + 1] << 8, a += 2) : (l = (t[a] | t[a + 1] << 8 | t[a + 2] << 16 | t[a + 3] << 24) >>> 0, a += 4)), l == 0) throw Error("Invalid offset 0");
			for (var d = i.length - 1, f = l; d >= 0 && f >= i[d].length;) f -= i[d].length, --d;
			if (d < 0) if (f == 0) f = i[d = 0].length;
			else throw Error("Invalid offset beyond length");
			if (u < f) i.push(i[d][mh](i[d].length - f, i[d].length - f + u));
			else {
				for (f > 0 && (i.push(i[d][mh](i[d].length - f)), u -= f), ++d; u >= i[d].length;) i.push(i[d]), u -= i[d].length, ++d;
				u && i.push(i[d][mh](0, u));
			}
			i.length > 25 && (i = [_h(i)]);
		}
	}
	for (var p = 0, m = 0; m < i.length; ++m) p += i[m].length;
	if (p != r) throw Error(`Unexpected length: ${p} != ${r}`);
	return i;
}
function Th(e) {
	Array.isArray(e) && (e = new Uint8Array(e));
	for (var t = [], n = 0; n < e.length;) {
		var r = e[n++], i = e[n] | e[n + 1] << 8 | e[n + 2] << 16;
		n += 3, t.push.apply(t, wh(r, e[mh](n, n + i))), n += i;
	}
	if (n !== e.length) throw Error("data is not a valid framed stream!");
	return t.length == 1 ? t[0] : _h(t);
}
var Eh = function() {
	return {
		sst: [],
		rsst: [],
		ofmt: [],
		nfmt: [],
		fmla: [],
		ferr: [],
		cmnt: []
	};
};
function Dh(e, t, n, r, i) {
	var a, o, s, c, l = t & 255, u = t >> 8, d = u >= 5 ? i : r;
	dur: if (n & (u > 4 ? 8 : 4) && e.t == "n" && l == 7) {
		var f = (a = d[7]) != null && a[0] ? xh(d[7][0].data) : -1;
		if (f == -1) break dur;
		var p = (o = d[15]) != null && o[0] ? xh(d[15][0].data) : -1, m = (s = d[16]) != null && s[0] ? xh(d[16][0].data) : -1, h = (c = d[40]) != null && c[0] ? xh(d[40][0].data) : -1, g = e.v, _ = g;
		autodur: if (h) {
			if (g == 0) {
				p = m = 2;
				break autodur;
			}
			p = g >= 604800 ? 1 : g >= 86400 ? 2 : g >= 3600 ? 4 : g >= 60 ? 8 : g >= 1 ? 16 : 32, Math.floor(g) == g ? g % 60 ? m = 16 : g % 3600 ? m = 8 : g % 86400 ? m = 4 : g % 604800 && (m = 2) : m = 32, m < p && (m = p);
		}
		if (p == -1 || m == -1) break dur;
		var v = [], y = [];
		p == 1 && (_ = g / 604800, m == 1 ? y.push("d\"d\"") : (_ |= 0, g -= 604800 * _), v.push(_ + (f == 2 ? " week" + (_ == 1 ? "" : "s") : f == 1 ? "w" : ""))), p <= 2 && m >= 2 && (_ = g / 86400, m > 2 && (_ |= 0, g -= 86400 * _), y.push("d\"d\""), v.push(_ + (f == 2 ? " day" + (_ == 1 ? "" : "s") : f == 1 ? "d" : ""))), p <= 4 && m >= 4 && (_ = g / 3600, m > 4 && (_ |= 0, g -= 3600 * _), y.push((p >= 4 ? "[h]" : "h") + "\"h\""), v.push(_ + (f == 2 ? " hour" + (_ == 1 ? "" : "s") : f == 1 ? "h" : ""))), p <= 8 && m >= 8 && (_ = g / 60, m > 8 && (_ |= 0, g -= 60 * _), y.push((p >= 8 ? "[m]" : "m") + "\"m\""), f == 0 ? v.push((p == 8 && m == 8 || _ >= 10 ? "" : "0") + _) : v.push(_ + (f == 2 ? " minute" + (_ == 1 ? "" : "s") : f == 1 ? "m" : ""))), p <= 16 && m >= 16 && (_ = g, m > 16 && (_ |= 0, g -= _), y.push((p >= 16 ? "[s]" : "s") + "\"s\""), f == 0 ? v.push((m == 16 && p == 16 || _ >= 10 ? "" : "0") + _) : v.push(_ + (f == 2 ? " second" + (_ == 1 ? "" : "s") : f == 1 ? "s" : ""))), m >= 32 && (_ = Math.round(1e3 * g), p < 32 && y.push(".000\"ms\""), f == 0 ? v.push((_ >= 100 ? "" : _ >= 10 ? "0" : "00") + _) : v.push(_ + (f == 2 ? " millisecond" + (_ == 1 ? "" : "s") : f == 1 ? "ms" : ""))), e.w = v.join(f == 0 ? ":" : " "), e.z = y.join(f == 0 ? "\":\"" : " "), f == 0 && (e.w = e.w.replace(/:(\d\d\d)$/, ".$1"));
	}
}
function Oh(e, t, n, r) {
	var i = hh(e), a = i.getUint32(4, !0), o = -1, s = -1, c = -1, l = NaN, u = 0, d = new Date(Date.UTC(2001, 0, 1)), f = n > 1 ? 12 : 8;
	a & 2 && (c = i.getUint32(f, !0), f += 4), f += vh(a & (n > 1 ? 3468 : 396)) * 4, a & 512 && (o = i.getUint32(f, !0), f += 4), f += vh(a & (n > 1 ? 12288 : 4096)) * 4, a & 16 && (s = i.getUint32(f, !0), f += 4), a & 32 && (l = i.getFloat64(f, !0), f += 8), a & 64 && (d.setTime(d.getTime() + (u = i.getFloat64(f, !0)) * 1e3), f += 8), n > 1 && (a = i.getUint32(8, !0) >>> 16, a & 255 && (c == -1 && (c = i.getUint32(f, !0)), f += 4));
	var p, m = e[n >= 4 ? 1 : 2];
	switch (m) {
		case 0: return;
		case 2:
			p = {
				t: "n",
				v: l
			};
			break;
		case 3:
			p = {
				t: "s",
				v: t.sst[s]
			};
			break;
		case 5:
			p = r != null && r.cellDates ? {
				t: "d",
				v: d
			} : {
				t: "n",
				v: u / 86400 + 35430,
				z: V[14]
			};
			break;
		case 6:
			p = {
				t: "b",
				v: l > 0
			};
			break;
		case 7:
			p = {
				t: "n",
				v: l
			};
			break;
		case 8:
			p = {
				t: "e",
				v: 0
			};
			break;
		case 9:
			if (o > -1) {
				var h = t.rsst[o];
				p = {
					t: "s",
					v: h.v
				}, h.l && (p.l = { Target: h.l });
			} else throw Error(`Unsupported cell type ${e[mh](0, 4)}`);
			break;
		default: throw Error(`Unsupported cell type ${e[mh](0, 4)}`);
	}
	return c > -1 && Dh(p, m | n << 8, a, t.ofmt[c], t.nfmt[c]), m == 7 && (p.v /= 86400), p;
}
function kh(e, t, n) {
	var r = hh(e);
	r.getUint32(4, !0);
	var i = r.getUint32(8, !0), a = 12, o = -1, s = -1, c = -1, l = NaN, u = NaN, d = 0, f = new Date(Date.UTC(2001, 0, 1));
	i & 1 && (l = yh(e, a), a += 16), i & 2 && (u = r.getFloat64(a, !0), a += 8), i & 4 && (f.setTime(f.getTime() + (d = r.getFloat64(a, !0)) * 1e3), a += 8), i & 8 && (s = r.getUint32(a, !0), a += 4), i & 16 && (o = r.getUint32(a, !0), a += 4), a += vh(i & 480) * 4, i & 512 && (r.getUint32(a, !0), a += 4), a += vh(i & 1024) * 4, i & 2048 && (r.getUint32(a, !0), a += 4);
	var p, m = e[1];
	switch (m) {
		case 0:
			p = { t: "z" };
			break;
		case 2:
			p = {
				t: "n",
				v: l
			};
			break;
		case 3:
			p = {
				t: "s",
				v: t.sst[s]
			};
			break;
		case 5:
			p = n != null && n.cellDates ? {
				t: "d",
				v: f
			} : {
				t: "n",
				v: d / 86400 + 35430,
				z: V[14]
			};
			break;
		case 6:
			p = {
				t: "b",
				v: u > 0
			};
			break;
		case 7:
			p = {
				t: "n",
				v: u
			};
			break;
		case 8:
			p = {
				t: "e",
				v: 0
			};
			break;
		case 9:
			if (o > -1) {
				var h = t.rsst[o];
				p = {
					t: "s",
					v: h.v
				}, h.l && (p.l = { Target: h.l });
			} else throw Error(`Unsupported cell type ${e[1]} : ${i & 31} : ${e[mh](0, 4)}`);
			break;
		case 10:
			p = {
				t: "n",
				v: l
			};
			break;
		default: throw Error(`Unsupported cell type ${e[1]} : ${i & 31} : ${e[mh](0, 4)}`);
	}
	if (a += vh(i & 4096) * 4, i & 516096 && (c == -1 && (c = r.getUint32(a, !0)), a += 4), i & 524288) {
		var g = r.getUint32(a, !0);
		a += 4, t.cmnt[g] && (p.c = Ih(t.cmnt[g]));
	}
	return c > -1 && Dh(p, m | 1280, i >> 13, t.ofmt[c], t.nfmt[c]), m == 7 && (p.v /= 86400), p;
}
function Ah(e, t, n) {
	switch (e[0]) {
		case 0:
		case 1:
		case 2:
		case 3:
		case 4: return Oh(e, t, e[0], n);
		case 5: return kh(e, t, n);
		default: throw Error(`Unsupported payload version ${e[0]}`);
	}
}
function jh(e) {
	return xh(Z(e)[1][0].data);
}
function Mh(e, t) {
	var n = Z(t.data), r = xh(n[1][0].data), i = n[3], a = [];
	return (i || []).forEach(function(t) {
		var n, i, o = Z(t.data);
		if (o[1]) {
			var s = xh(o[1][0].data) >>> 0;
			switch (r) {
				case 1:
					a[s] = gh(o[3][0].data);
					break;
				case 8:
					var c = e[jh(o[9][0].data)][0], l = e[jh(Z(c.data)[1][0].data)][0], u = xh(l.meta[1][0].data);
					if (u != 2001) throw Error(`2000 unexpected reference to ${u}`);
					var d = Z(l.data), f = { v: d[3].map(function(e) {
						return gh(e.data);
					}).join("") };
					a[s] = f;
					sfields: if ((n = d == null ? void 0 : d[11]) != null && n[0]) {
						var p = (i = Z(d[11][0].data)) == null ? void 0 : i[1];
						if (!p) break sfields;
						p.forEach(function(t) {
							var n, r, i, a = Z(t.data);
							if ((n = a[2]) != null && n[0]) {
								var o = e[jh((r = a[2]) == null ? void 0 : r[0].data)][0], s = xh(o.meta[1][0].data);
								switch (s) {
									case 2032:
										var c = Z(o.data);
										(i = c == null ? void 0 : c[2]) != null && i[0] && !f.l && (f.l = gh(c[2][0].data));
										break;
									case 2039: break;
									default: console.log(`unrecognized ObjectAttribute type ${s}`);
								}
							}
						});
					}
					break;
				case 2:
					a[s] = Z(o[6][0].data);
					break;
				case 3:
					a[s] = Z(o[5][0].data);
					break;
				case 10:
					var m = e[jh(o[10][0].data)][0];
					a[s] = Fh(e, m.data);
					break;
				default: throw r;
			}
		}
	}), a;
}
function Nh(e, t) {
	var n, r, i, a, o, s, c, l, u, d, f, p, m, h, g = Z(e), _ = xh(g[1][0].data) >>> 0, v = xh(g[2][0].data) >>> 0, y = ((r = (n = g[8]) == null ? void 0 : n[0]) == null ? void 0 : r.data) && xh(g[8][0].data) > 0 || !1, b, x;
	if ((a = (i = g[7]) == null ? void 0 : i[0]) != null && a.data && t != 0) b = (s = (o = g[7]) == null ? void 0 : o[0]) == null ? void 0 : s.data, x = (l = (c = g[6]) == null ? void 0 : c[0]) == null ? void 0 : l.data;
	else if ((d = (u = g[4]) == null ? void 0 : u[0]) != null && d.data && t != 1) b = (p = (f = g[4]) == null ? void 0 : f[0]) == null ? void 0 : p.data, x = (h = (m = g[3]) == null ? void 0 : m[0]) == null ? void 0 : h.data;
	else throw `NUMBERS Tile missing ${t} cell storage`;
	for (var S = y ? 4 : 1, C = hh(b), w = [], T = 0; T < b.length / 2; ++T) {
		var E = C.getUint16(T * 2, !0);
		E < 65535 && w.push([T, E]);
	}
	if (w.length != v) throw `Expected ${v} cells, found ${w.length}`;
	var D = [];
	for (T = 0; T < w.length - 1; ++T) D[w[T][0]] = x[mh](w[T][1] * S, w[T + 1][1] * S);
	return w.length >= 1 && (D[w[w.length - 1][0]] = x[mh](w[w.length - 1][1] * S)), {
		R: _,
		cells: D
	};
}
function Ph(e, t) {
	var n, r = Z(t.data), i = -1;
	(n = r == null ? void 0 : r[7]) != null && n[0] && (i = xh(r[7][0].data) >>> 0 ? 1 : 0);
	var a = Sh(r[5], function(e) {
		return Nh(e, i);
	});
	return {
		nrows: xh(r[4][0].data) >>> 0,
		data: a.reduce(function(e, t) {
			return e[t.R] || (e[t.R] = []), t.cells.forEach(function(n, r) {
				if (e[t.R][r]) throw Error(`Duplicate cell r=${t.R} c=${r}`);
				e[t.R][r] = n;
			}), e;
		}, [])
	};
}
function Fh(e, t) {
	var n, r, i, a, o, s, c, l, u, d, f = {
		t: "",
		a: ""
	}, p = Z(t);
	if ((r = (n = p == null ? void 0 : p[1]) == null ? void 0 : n[0]) != null && r.data && (f.t = gh((a = (i = p == null ? void 0 : p[1]) == null ? void 0 : i[0]) == null ? void 0 : a.data) || ""), (s = (o = p == null ? void 0 : p[3]) == null ? void 0 : o[0]) != null && s.data) {
		var m = e[jh((l = (c = p == null ? void 0 : p[3]) == null ? void 0 : c[0]) == null ? void 0 : l.data)][0], h = Z(m.data);
		(d = (u = h[1]) == null ? void 0 : u[0]) != null && d.data && (f.a = gh(h[1][0].data));
	}
	return p != null && p[4] && (f.replies = [], p[4].forEach(function(t) {
		var n = e[jh(t.data)][0];
		f.replies.push(Fh(e, n.data));
	})), f;
}
function Ih(e) {
	var t = [];
	return t.push({
		t: e.t || "",
		a: e.a,
		T: e.replies && e.replies.length > 0
	}), e.replies && e.replies.forEach(function(e) {
		t.push({
			t: e.t || "",
			a: e.a,
			T: !0
		});
	}), t;
}
function Lh(e, t, n, r) {
	var i, a, o, s, c, l, u, d, f, p, m, h, g, _, v = Z(t.data), y = {
		s: {
			r: 0,
			c: 0
		},
		e: {
			r: 0,
			c: 0
		}
	};
	if (y.e.r = (xh(v[6][0].data) >>> 0) - 1, y.e.r < 0) throw Error(`Invalid row varint ${v[6][0].data}`);
	if (y.e.c = (xh(v[7][0].data) >>> 0) - 1, y.e.c < 0) throw Error(`Invalid col varint ${v[7][0].data}`);
	n["!ref"] = X(y);
	var b = n["!data"] != null, x = n, S = Z(v[4][0].data), C = Eh();
	(i = S[4]) != null && i[0] && (C.sst = Mh(e, e[jh(S[4][0].data)][0])), (a = S[6]) != null && a[0] && (C.fmla = Mh(e, e[jh(S[6][0].data)][0])), (o = S[11]) != null && o[0] && (C.ofmt = Mh(e, e[jh(S[11][0].data)][0])), (s = S[12]) != null && s[0] && (C.ferr = Mh(e, e[jh(S[12][0].data)][0])), (c = S[17]) != null && c[0] && (C.rsst = Mh(e, e[jh(S[17][0].data)][0])), (l = S[19]) != null && l[0] && (C.cmnt = Mh(e, e[jh(S[19][0].data)][0])), (u = S[22]) != null && u[0] && (C.nfmt = Mh(e, e[jh(S[22][0].data)][0]));
	var w = Z(S[3][0].data), T = 0;
	if (!((d = S[9]) != null && d[0])) throw "NUMBERS file missing row tree";
	if (Z(S[9][0].data)[1].map(function(e) {
		return Z(e.data);
	}).forEach(function(t) {
		T = xh(t[1][0].data);
		var i = xh(t[2][0].data), a = w[1][i];
		if (!a) throw "NUMBERS missing tile " + i;
		var o = e[jh(Z(a.data)[2][0].data)][0], s = xh(o.meta[1][0].data);
		if (s != 6002) throw Error(`6001 unexpected reference to ${s}`);
		var c = Ph(e, o);
		c.data.forEach(function(e, t) {
			e.forEach(function(e, i) {
				var a = Ah(e, C, r);
				a && (b ? (x["!data"][T + t] || (x["!data"][T + t] = []), x["!data"][T + t][i] = a) : n[Dr(i) + Cr(T + t)] = a);
			});
		}), T += c.nrows;
	}), (f = S[13]) != null && f[0]) {
		var E = e[jh(S[13][0].data)][0], D = xh(E.meta[1][0].data);
		if (D != 6144) throw Error(`Expected merge type 6144, found ${D}`);
		n["!merges"] = (p = Z(E.data)) == null ? void 0 : p[1].map(function(e) {
			var t = Z(e.data), n = hh(Z(t[1][0].data)[1][0].data), r = hh(Z(t[2][0].data)[1][0].data);
			return {
				s: {
					r: n.getUint16(0, !0),
					c: n.getUint16(2, !0)
				},
				e: {
					r: n.getUint16(0, !0) + r.getUint16(0, !0) - 1,
					c: n.getUint16(2, !0) + r.getUint16(2, !0) - 1
				}
			};
		});
	}
	if (!((m = n["!merges"]) != null && m.length) && (h = v[47]) != null && h[0]) {
		var O = Z(v[47][0].data);
		if ((g = O[2]) != null && g[0]) {
			var k = Z(O[2][0].data);
			(_ = k[3]) != null && _[0] && (n["!merges"] = Sh(k[3], function(e) {
				var t, n, r, i, a, o = Z(Z(Z(e)[2][0].data)[1][0].data);
				if ((t = o[1]) != null && t[0]) {
					var s = Z(o[1][0].data);
					if (xh(s[1][0].data) == 67) {
						var c = Z(s[40][0].data);
						if (!(!((n = c[3]) != null && n[0]) || !((r = c[4]) != null && r[0]))) {
							var l = Z(c[3][0].data), u = Z(c[4][0].data), d = xh(l[1][0].data), f = (i = l[2]) != null && i[0] ? xh(l[2][0].data) : d, p = xh(u[1][0].data), m = (a = u[2]) != null && a[0] ? xh(u[2][0].data) : p;
							return {
								s: {
									r: p,
									c: d
								},
								e: {
									r: m,
									c: f
								}
							};
						}
					}
				}
			}).filter(function(e) {
				return e != null;
			}));
		}
	}
}
function Rh(e, t, n) {
	var r = Z(t.data), i = { "!ref": "A1" };
	n != null && n.dense && (i["!data"] = []);
	var a = e[jh(r[2][0].data)], o = xh(a[0].meta[1][0].data);
	if (o != 6001) throw Error(`6000 unexpected reference to ${o}`);
	return Lh(e, a[0], i, n), i;
}
function zh(e, t, n) {
	var r, i = Z(t.data), a = {
		name: (r = i[1]) != null && r[0] ? gh(i[1][0].data) : "",
		sheets: []
	};
	return Sh(i[2], jh).forEach(function(t) {
		e[t].forEach(function(t) {
			xh(t.meta[1][0].data) == 6e3 && a.sheets.push(Rh(e, t, n));
		});
	}), a;
}
function Bh(e, t, n) {
	var r, i = yg();
	i.Workbook = { WBProps: { date1904: !0 } };
	var a = Z(t.data);
	if ((r = a[2]) != null && r[0]) throw Error("Keynote presentations are not supported");
	if (Sh(a[1], jh).forEach(function(t) {
		e[t].forEach(function(t) {
			if (xh(t.meta[1][0].data) == 2) {
				var r = zh(e, t, n);
				r.sheets.forEach(function(e, t) {
					bg(i, e, t == 0 ? r.name : r.name + "_" + t, !0);
				});
			}
		});
	}), i.SheetNames.length == 0) throw Error("Empty NUMBERS file");
	return i.bookType = "numbers", i;
}
function Vh(e, t) {
	var n, r, i, a, o, s, c, l = {}, u = [];
	if (e.FullPaths.forEach(function(e) {
		if (e.match(/\.iwpv2/)) throw Error("Unsupported password protection");
	}), e.FileIndex.forEach(function(e) {
		if (e.name.match(/\.iwa$/) && e.content[0] == 0) {
			var t;
			try {
				t = Th(e.content);
			} catch (t) {
				return console.log("?? " + e.content.length + " " + (t.message || t));
			}
			var n;
			try {
				n = Ch(t);
			} catch (e) {
				return console.log("## " + (e.message || e));
			}
			n.forEach(function(e) {
				l[e.id] = e.messages, u.push(e.id);
			});
		}
	}), !u.length) throw Error("File has no messages");
	if ((i = (r = (n = l == null ? void 0 : l[1]) == null ? void 0 : n[0].meta) == null ? void 0 : r[1]) != null && i[0].data && xh(l[1][0].meta[1][0].data) == 1e4) throw Error("Pages documents are not supported");
	var d = ((c = (s = (o = (a = l == null ? void 0 : l[1]) == null ? void 0 : a[0]) == null ? void 0 : o.meta) == null ? void 0 : s[1]) == null ? void 0 : c[0].data) && xh(l[1][0].meta[1][0].data) == 1 && l[1][0];
	if (d || u.forEach(function(e) {
		l[e].forEach(function(e) {
			if (xh(e.meta[1][0].data) >>> 0 == 1) if (!d) d = e;
			else throw Error("Document has multiple roots");
		});
	}), !d) throw Error("Cannot find Document root");
	return Bh(l, d, t);
}
function Hh(e) {
	return function(t) {
		for (var n = 0; n != e.length; ++n) {
			var r = e[n];
			t[r[0]] === void 0 && (t[r[0]] = r[1]), r[2] === "n" && (t[r[0]] = Number(t[r[0]]));
		}
	};
}
function Uh(e) {
	Hh([
		["cellNF", !1],
		["cellHTML", !0],
		["cellFormula", !0],
		["cellStyles", !1],
		["cellText", !0],
		["cellDates", !1],
		["sheetStubs", !1],
		[
			"sheetRows",
			0,
			"n"
		],
		["bookDeps", !1],
		["bookSheets", !1],
		["bookProps", !1],
		["bookFiles", !1],
		["bookVBA", !1],
		["password", ""],
		["WTF", !1]
	])(e);
}
function Wh(e) {
	return Mi.WS.indexOf(e) > -1 ? "sheet" : Mi.CS && e == Mi.CS ? "chart" : Mi.DS && e == Mi.DS ? "dialog" : Mi.MS && e == Mi.MS ? "macro" : e && e.length ? e : "sheet";
}
function Gh(e, t) {
	if (!e) return 0;
	try {
		e = t.map(function(t) {
			return t.id || (t.id = t.strRelID), [
				t.name,
				e["!id"][t.id].Target,
				Wh(e["!id"][t.id].Type)
			];
		});
	} catch {
		return null;
	}
	return !e || e.length === 0 ? null : e;
}
function Kh(e, t, n, r, i, a, o, s) {
	if (!(!e || !e["!legdrawel"])) {
		var c = Gt(n, Xt(e["!legdrawel"].Target, r), !0);
		c && Vl(vn(c), e, s || []);
	}
}
function qh(e) {
	switch ((e || "").toLowerCase().replace(/.*\./, "")) {
		case "png": return "image/png";
		case "gif": return "image/gif";
		case "bmp": return "image/bmp";
		case "svg": return "image/svg+xml";
		case "jpg":
		case "jpeg": return "image/jpeg";
		default: return "application/octet-stream";
	}
}
function Jh(e, t, n, r, i, a, o) {
	if (!(!e || !e["!drawel"]) && !(!a || !a.drawings && !a.charts)) {
		var s = Xt(e["!drawel"].Target, r), c = Ni(s), l = Dl(Gt(n, s, !0), Pi(Gt(n, c, !0), s));
		e["!drawings"] = l, a.drawings && l.images && l.images.length && l.images.forEach(function(e) {
			if (!(!e || !e.target)) {
				var t = Xt(e.target, s), r = Kt(n, t, !0);
				r && (e.dataURI = "data:" + qh(t) + ";base64," + x(r)), e.path = t;
			}
		}), a.charts && l.charts && l.charts.length && (e["!charts"] = [], l.charts.forEach(function(t) {
			if (!(!t || !t.target)) {
				var r = Xt(t.target, s), i = Ni(r), c = pp(Gt(n, r, !0), r, a, Pi(Gt(n, i, !0), r), o, { "!type": "chart" });
				t.model = c && c["!chart"], t.data = c, t.path = r, e["!charts"].push(t);
			}
		}));
	}
}
function Yh(e, t, n, r, i, a, o, s, c, l, u, d) {
	try {
		a[r] = Pi(Gt(e, n, !0), t);
		var f = Wt(e, t), p;
		switch (s) {
			case "sheet":
				p = Pp(f, t, i, c, a[r], l, u, d);
				break;
			case "chart":
				if (p = Fp(f, t, i, c, a[r], l, u, d), !p || !p["!drawel"] || !c.drawings && !c.charts) break;
				var m = Xt(p["!drawel"].Target, t), h = Ni(m), g = Dl(Gt(e, m, !0), Pi(Gt(e, h, !0), m));
				if (p["!drawings"] = g, !c.charts || !g.chart) break;
				var _ = Xt(g.chart, m), v = Ni(_);
				p = pp(Gt(e, _, !0), _, c, Pi(Gt(e, v, !0), _), l, p), g.charts && g.charts.length && (g.charts[0].model = p && p["!chart"], p["!charts"] = g.charts);
				break;
			case "macro":
				p = Ip(f, t, i, c, a[r], l, u, d);
				break;
			case "dialog":
				p = Lp(f, t, i, c, a[r], l, u, d);
				break;
			default: throw Error("Unrecognized sheet type " + s);
		}
		o[r] = p;
		var y = [], b = [];
		a && a[r] && rt(a[r]).forEach(function(n) {
			var i = "";
			if (a[r][n].Type == Mi.CMNT) {
				if (i = Xt(a[r][n].Target, t), y = Bp(Wt(e, i, !0), i, c), !y || !y.length) return;
				Hl(p, y, !1);
			}
			a[r][n].Type == Mi.TCMNT && (i = Xt(a[r][n].Target, t), b = b.concat(Wl(Wt(e, i, !0), c)));
		}), b && b.length && Hl(p, b, !0, c.people || []), s == "sheet" && Jh(p, s, e, t, i, c, l), Kh(p, s, e, t, i, c, l, y);
	} catch (e) {
		if (c.WTF) throw e;
	}
}
function Xh(e) {
	return e.charAt(0) == "/" ? e.slice(1) : e;
}
function Zh(e, t) {
	if (Ke(), t = t || {}, Uh(t), Ht(e, "META-INF/manifest.xml") || Ht(e, "objectdata.xml")) return fh(e, t);
	if (Ht(e, "Index/Document.iwa")) {
		if (typeof Uint8Array > "u") throw Error("NUMBERS file parsing requires Uint8Array support");
		if (Vh !== void 0) {
			if (e.FileIndex) return Vh(e, t);
			var n = et.utils.cfb_new();
			return qt(e).forEach(function(t) {
				Jt(n, t, Kt(e, t));
			}), Vh(n, t);
		}
		throw Error("Unsupported NUMBERS file");
	}
	if (!Ht(e, "[Content_Types].xml")) {
		if (Ht(e, "index.xml.gz")) throw Error("Unsupported NUMBERS 08 file");
		if (Ht(e, "index.xml")) throw Error("Unsupported NUMBERS 09 file");
		var r = et.find(e, "Index.zip");
		if (r) return t = gt(t), delete t.type, typeof r.content == "string" && (t.type = "binary"), typeof Bun < "u" && Buffer.isBuffer(r.content) ? sg(new Uint8Array(r.content), t) : sg(r.content, t);
		throw Error("Unsupported ZIP file");
	}
	var i = qt(e), a = ji(Gt(e, "[Content_Types].xml")), o = !1, s, c;
	if (a.workbooks.length === 0 && (c = "xl/workbook.xml", Wt(e, c, !0) && a.workbooks.push(c)), a.workbooks.length === 0) {
		if (c = "xl/workbook.bin", !Wt(e, c, !0)) throw Error("Could not find workbook");
		a.workbooks.push(c), o = !0;
	}
	a.workbooks[0].slice(-3) == "bin" && (o = !0);
	var l = {}, u = {};
	if (!t.bookSheets && !t.bookProps) {
		if ($d = [], a.sst) try {
			$d = zp(Wt(e, Xh(a.sst)), a.sst, t);
		} catch (e) {
			if (t.WTF) throw e;
		}
		t.cellStyles && a.themes.length && (l = cl(Gt(e, a.themes[0].replace(/^\//, ""), !0) || "", t)), a.style && (u = Rp(Wt(e, Xh(a.style)), a.style, l, t));
	}
	a.links.map(function(n) {
		try {
			var r = Pi(Gt(e, Ni(Xh(n))), n);
			return Hp(Wt(e, Xh(n)), r, n, t);
		} catch {}
	});
	var d = Np(Wt(e, Xh(a.workbooks[0])), a.workbooks[0], t), f = {}, p = "";
	a.coreprops.length && (p = Wt(e, Xh(a.coreprops[0]), !0), p && (f = Ri(p)), a.extprops.length !== 0 && (p = Wt(e, Xh(a.extprops[0]), !0), p && Vi(p, f, t)));
	var m = {};
	(!t.bookSheets || t.bookProps) && a.custprops.length !== 0 && (p = Gt(e, Xh(a.custprops[0]), !0), p && (m = Ui(p, t)));
	var h = {};
	if ((t.bookSheets || t.bookProps) && (d.Sheets ? s = d.Sheets.map(function(e) {
		return e.name;
	}) : f.Worksheets && f.SheetNames.length > 0 && (s = f.SheetNames), t.bookProps && (h.Props = f, h.Custprops = m), t.bookSheets && s !== void 0 && (h.SheetNames = s), t.bookSheets ? h.SheetNames : t.bookProps)) return h;
	s = {};
	var g = {};
	t.bookDeps && a.calcchain && (g = Vp(Wt(e, Xh(a.calcchain)), a.calcchain, t));
	var _ = 0, v = {}, y, b, x = d.Sheets;
	f.Worksheets = x.length, f.SheetNames = [];
	for (var S = 0; S != x.length; ++S) f.SheetNames[S] = x[S].name;
	var C = o ? "bin" : "xml", w = a.workbooks[0].lastIndexOf("/"), T = (a.workbooks[0].slice(0, w + 1) + "_rels/" + a.workbooks[0].slice(w + 1) + ".rels").replace(/^\//, "");
	Ht(e, T) || (T = "xl/_rels/workbook." + C + ".rels");
	var E = Pi(Gt(e, T, !0), T.replace(/_rels.*/, "s5s"));
	(a.metadata || []).length >= 1 && (t.xlmeta = Up(Wt(e, Xh(a.metadata[0])), a.metadata[0], t)), (a.people || []).length >= 1 && (t.people = Gl(Wt(e, Xh(a.people[0])), t)), E && (E = Gh(E, d.Sheets));
	var D = +!!Wt(e, "xl/worksheets/sheet.xml", !0);
	wsloop: for (_ = 0; _ != f.Worksheets; ++_) {
		var O = "sheet";
		if (E && E[_] ? (y = "xl/" + E[_][1].replace(/[\/]?xl\//, ""), Ht(e, y) || (y = E[_][1]), Ht(e, y) || (y = T.replace(/_rels\/[\S\s]*$/, "") + E[_][1]), O = E[_][2]) : (y = "xl/worksheets/sheet" + (_ + 1 - D) + "." + C, y = y.replace(/sheet0\./, "sheet.")), b = y.replace(/^(.*)(\/)([^\/]*)$/, "$1/_rels/$3.rels"), t && t.sheets != null) switch (typeof t.sheets) {
			case "number":
				if (_ != t.sheets) continue wsloop;
				break;
			case "string":
				if (f.SheetNames[_].toLowerCase() != t.sheets.toLowerCase()) continue wsloop;
				break;
			default: if (Array.isArray && Array.isArray(t.sheets)) {
				for (var k = !1, A = 0; A != t.sheets.length; ++A) typeof t.sheets[A] == "number" && t.sheets[A] == _ && (k = 1), typeof t.sheets[A] == "string" && t.sheets[A].toLowerCase() == f.SheetNames[_].toLowerCase() && (k = 1);
				if (!k) continue wsloop;
			}
		}
		Yh(e, y, b, f.SheetNames[_], _, v, s, O, t, d, l, u);
	}
	return h = {
		Directory: a,
		Workbook: d,
		Props: f,
		Custprops: m,
		Deps: g,
		Sheets: s,
		SheetNames: f.SheetNames,
		Strings: $d,
		Styles: u,
		Themes: l,
		SSF: gt(V)
	}, t && t.bookFiles && (e.files ? (h.keys = i, h.files = e.files) : (h.keys = [], h.files = {}, e.FullPaths.forEach(function(t, n) {
		t = t.replace(/^Root Entry[\/]/, ""), h.keys.push(t), h.files[t] = e.FileIndex[n];
	}))), t && t.bookVBA && (a.vba.length > 0 ? h.vbaraw = Wt(e, Xh(a.vba[0]), !0) : a.defaults && a.defaults.bin === Yl && (h.vbaraw = Wt(e, "xl/vbaProject.bin", !0))), h.bookType = o ? "xlsb" : "xlsx", h;
}
function Qh(e, t) {
	var n = t || {}, r = "Workbook", i = et.find(e, r);
	try {
		if (r = "/!DataSpaces/Version", i = et.find(e, r), !i || !i.content || (Ds(i.content), r = "/!DataSpaces/DataSpaceMap", i = et.find(e, r), !i || !i.content)) throw Error("ECMA-376 Encrypted file missing " + r);
		var a = ks(i.content);
		if (a.length !== 1 || a[0].comps.length !== 1 || a[0].comps[0].t !== 0 || a[0].name !== "StrongEncryptionDataSpace" || a[0].comps[0].v !== "EncryptedPackage") throw Error("ECMA-376 Encrypted file bad " + r);
		if (r = "/!DataSpaces/DataSpaceInfo/StrongEncryptionDataSpace", i = et.find(e, r), !i || !i.content) throw Error("ECMA-376 Encrypted file missing " + r);
		var o = As(i.content);
		if (o.length != 1 || o[0] != "StrongEncryptionTransform") throw Error("ECMA-376 Encrypted file bad " + r);
		if (r = "/!DataSpaces/TransformInfo/StrongEncryptionTransform/!Primary", i = et.find(e, r), !i || !i.content) throw Error("ECMA-376 Encrypted file missing " + r);
		Ms(i.content);
	} catch {}
	if (r = "/EncryptionInfo", i = et.find(e, r), !i || !i.content) throw Error("ECMA-376 Encrypted file missing " + r);
	var s = Fs(i.content);
	if (r = "/EncryptedPackage", i = et.find(e, r), !i || !i.content) throw Error("ECMA-376 Encrypted file missing " + r);
	if (s[0] == 4 && typeof decrypt_agile < "u") return decrypt_agile(s[1], i.content, n.password || "", n);
	if (s[0] == 2 && typeof decrypt_std76 < "u") return decrypt_std76(s[1], i.content, n.password || "", n);
	throw Error("File is password-protected");
}
function $h(e, t) {
	var n = "";
	switch ((t || {}).type || "base64") {
		case "buffer": return [
			e[0],
			e[1],
			e[2],
			e[3],
			e[4],
			e[5],
			e[6],
			e[7]
		];
		case "base64":
			n = S(e.slice(0, 12));
			break;
		case "binary":
			n = e;
			break;
		case "array": return [
			e[0],
			e[1],
			e[2],
			e[3],
			e[4],
			e[5],
			e[6],
			e[7]
		];
		default: throw Error("Unrecognized type " + (t && t.type || "undefined"));
	}
	return [
		n.charCodeAt(0),
		n.charCodeAt(1),
		n.charCodeAt(2),
		n.charCodeAt(3),
		n.charCodeAt(4),
		n.charCodeAt(5),
		n.charCodeAt(6),
		n.charCodeAt(7)
	];
}
function eg(e, t) {
	return et.find(e, "EncryptedPackage") ? Qh(e, t) : Am(e, t);
}
function tg(e, t) {
	var n, r = e, i = t || {};
	return i.type || (i.type = C && Buffer.isBuffer(e) ? "buffer" : "base64"), n = Yt(r, i), Zh(n, i);
}
function ng(e, t) {
	var n = 0;
	main: for (; n < e.length;) switch (e.charCodeAt(n)) {
		case 10:
		case 13:
		case 32:
			++n;
			break;
		case 60: return rm(e.slice(n), t);
		default: break main;
	}
	return us.to_workbook(e, t);
}
function rg(e, t) {
	var n = "", r = $h(e, t);
	switch (t.type) {
		case "base64":
			n = S(e);
			break;
		case "binary":
			n = e;
			break;
		case "buffer":
			n = e.toString("binary");
			break;
		case "array":
			n = ht(e);
			break;
		default: throw Error("Unrecognized type " + t.type);
	}
	return r[0] == 239 && r[1] == 187 && r[2] == 191 && (n = vn(n)), t.type = "binary", ng(n, t);
}
function ig(e, t) {
	var n = e;
	return t.type == "base64" && (n = S(n)), typeof ArrayBuffer < "u" && e instanceof ArrayBuffer && (n = new Uint8Array(e)), n = r === void 0 ? C && Buffer.isBuffer(e) ? e.slice(2).toString("utf16le") : typeof Uint8Array < "u" && n instanceof Uint8Array ? typeof TextDecoder < "u" ? new TextDecoder("utf-16le").decode(n.slice(2)) : f(n.slice(2)) : d(n.slice(2)) : r.utils.decode(1200, n.slice(2), "str"), t.type = "binary", ng(n, t);
}
function ag(e) {
	return e.match(/[^\x00-\x7F]/) ? yn(e) : e;
}
function og(e, t, n, r) {
	return r ? (n.type = "string", us.to_workbook(e, n)) : us.to_workbook(t, n);
}
function sg(e, t) {
	l();
	var n = t || {};
	if (n.codepage && r === void 0 && console.error("Codepage tables are not loaded.  Non-ASCII characters may not give expected results"), typeof ArrayBuffer < "u" && e instanceof ArrayBuffer) return sg(new Uint8Array(e), (n = gt(n), n.type = "array", n));
	if (typeof Int8Array < "u" && e instanceof Int8Array) return sg(new Uint8Array(e.buffer, e.byteOffset, e.length), n);
	typeof Uint8Array < "u" && e instanceof Uint8Array && !n.type && (n.type = typeof Deno < "u" ? "buffer" : "array");
	var i = e, a = [
		0,
		0,
		0,
		0
	], o = !1;
	if (n.cellStyles && (n.cellNF = !0, n.sheetStubs = !0), ef = {}, n.dateNF && (ef.dateNF = n.dateNF), n.type || (n.type = C && Buffer.isBuffer(e) ? "buffer" : "base64"), n.type == "file" && (n.type = C ? "buffer" : "binary", i = nt(e), typeof Uint8Array < "u" && !C && (n.type = "array")), n.type == "string" && (o = !0, n.type = "binary", n.codepage = 65001, i = ag(e)), n.type == "array" && typeof Uint8Array < "u" && e instanceof Uint8Array && typeof ArrayBuffer < "u") {
		var s = new Uint8Array(/* @__PURE__ */ new ArrayBuffer(3));
		if (s.foo = "bar", !s.foo) return n = gt(n), n.type = "array", sg(A(i), n);
	}
	switch ((a = $h(i, n))[0]) {
		case 208:
			if (a[1] === 207 && a[2] === 17 && a[3] === 224 && a[4] === 161 && a[5] === 177 && a[6] === 26 && a[7] === 225) return eg(et.read(i, n), n);
			break;
		case 9:
			if (a[1] <= 8) return Am(i, n);
			break;
		case 60: return rm(i, n);
		case 73:
			if (a[1] === 73 && a[2] === 42 && a[3] === 0) throw Error("TIFF Image File is not a spreadsheet");
			if (a[1] === 68) return ds(i, n);
			break;
		case 84:
			if (a[1] === 65 && a[2] === 66 && a[3] === 76) return fs(i, n);
			break;
		case 80: return a[1] === 75 && a[2] < 9 && a[3] < 9 ? tg(i, n) : og(e, i, n, o);
		case 239: return a[3] === 60 ? rm(i, n) : og(e, i, n, o);
		case 255:
			if (a[1] === 254) return ig(i, n);
			if (a[1] === 0 && a[2] === 2 && a[3] === 0) return ps.to_workbook(i, n);
			break;
		case 0:
			if (a[1] === 0 && (a[2] >= 2 && a[3] === 0 || a[2] === 0 && (a[3] === 8 || a[3] === 9))) return ps.to_workbook(i, n);
			break;
		case 3:
		case 131:
		case 139:
		case 140: return os.to_workbook(i, n);
		case 123:
			if (a[1] === 92 && a[2] === 114 && a[3] === 116) return Xs(i, n);
			break;
		case 10:
		case 13:
		case 32: return rg(i, n);
		case 137:
			if (a[1] === 80 && a[2] === 78 && a[3] === 71) throw Error("PNG Image File is not a spreadsheet");
			break;
		case 37:
			if (a[1] === 80 && a[2] === 68 && a[3] === 70) throw Error("PDF File is not a spreadsheet");
			break;
		case 8:
			if (a[1] === 231) throw Error("Unsupported Multiplan 1.x file!");
			break;
		case 12:
			if (a[1] === 236) throw Error("Unsupported Multiplan 2.x file!");
			if (a[1] === 237) throw Error("Unsupported Multiplan 3.x file!");
			break;
	}
	return as.indexOf(a[0]) > -1 && a[2] <= 12 && a[3] <= 31 ? os.to_workbook(i, n) : og(e, i, n, o);
}
function cg(e, t, n, r, i, a, o) {
	var s = Cr(n), c = o.defval, l = o.raw || !Object.prototype.hasOwnProperty.call(o, "raw"), u = !0, d = e["!data"] != null, f = i === 1 ? [] : {};
	if (i !== 1) if (Object.defineProperty) try {
		Object.defineProperty(f, "__rowNum__", {
			value: n,
			enumerable: !1
		});
	} catch {
		f.__rowNum__ = n;
	}
	else f.__rowNum__ = n;
	if (!d || e["!data"][n]) for (var p = t.s.c; p <= t.e.c; ++p) {
		var m = d ? (e["!data"][n] || [])[p] : e[r[p] + s];
		if (m == null || m.t === void 0) {
			if (c === void 0) continue;
			a[p] != null && (f[a[p]] = c);
			continue;
		}
		var h = m.v;
		switch (m.t) {
			case "z":
				if (h == null) break;
				continue;
			case "e":
				h = h == 0 ? null : void 0;
				break;
			case "s":
			case "b": break;
			case "n": if (!m.z || !ze(m.z) || (h = lt(h), typeof h == "number")) break;
			case "d":
				o && (o.UTC || o.raw === !1) || (h = Ot(new Date(h)));
				break;
			default: throw Error("unrecognized type " + m.t);
		}
		if (a[p] != null) {
			if (h == null) if (m.t == "e" && h === null) f[a[p]] = null;
			else if (c !== void 0) f[a[p]] = c;
			else if (l && h === null) f[a[p]] = null;
			else continue;
			else f[a[p]] = (m.t === "n" && typeof o.rawNumbers == "boolean" ? o.rawNumbers : l) ? h : Ir(m, h, o);
			h != null && (u = !1);
		}
	}
	return {
		row: f,
		isempty: u
	};
}
function lg(e, t) {
	if (e == null || e["!ref"] == null) return [];
	var n = {
		t: "n",
		v: 0
	}, r = 0, i = 1, a = [], o = 0, s = "", c = {
		s: {
			r: 0,
			c: 0
		},
		e: {
			r: 0,
			c: 0
		}
	}, l = t || {}, u = l.range == null ? e["!ref"] : l.range;
	switch (l.header === 1 ? r = 1 : l.header === "A" ? r = 2 : Array.isArray(l.header) ? r = 3 : l.header == null && (r = 0), typeof u) {
		case "string":
			c = Pr(u);
			break;
		case "number":
			c = Pr(e["!ref"]), c.s.r = u;
			break;
		default: c = u;
	}
	r > 0 && (i = 0);
	var d = Cr(c.s.r), f = [], p = [], m = 0, h = 0, g = e["!data"] != null, _ = c.s.r, v = 0, y = {};
	g && !e["!data"][_] && (e["!data"][_] = []);
	var b = l.skipHidden && e["!cols"] || [], x = l.skipHidden && e["!rows"] || [];
	for (v = c.s.c; v <= c.e.c; ++v) if (!(b[v] || {}).hidden) switch (f[v] = Dr(v), n = g ? e["!data"][_][v] : e[f[v] + d], r) {
		case 1:
			a[v] = v - c.s.c;
			break;
		case 2:
			a[v] = f[v];
			break;
		case 3:
			a[v] = l.header[v - c.s.c];
			break;
		default:
			if (n == null && (n = {
				w: "__EMPTY",
				t: "s"
			}), s = o = Ir(n, null, l), h = y[o] || 0, !h) y[o] = 1;
			else {
				do
					s = o + "_" + h++;
				while (y[s]);
				y[o] = h, y[s] = 1;
			}
			a[v] = s;
	}
	for (_ = c.s.r + i; _ <= c.e.r; ++_) if (!(x[_] || {}).hidden) {
		var S = cg(e, c, _, f, r, a, l);
		(S.isempty === !1 || (r === 1 ? l.blankrows !== !1 : l.blankrows)) && (p[m++] = S.row);
	}
	return p.length = m, p;
}
var ug = /"/g;
function dg(e, t, n, r, i, a, o, s, c) {
	for (var l = !0, u = [], d = "", f = Cr(n), p = e["!data"] != null, m = p && e["!data"][n] || [], h = t.s.c; h <= t.e.c; ++h) if (r[h]) {
		var g = p ? m[h] : e[r[h] + f];
		if (g == null) d = "";
		else if (g.v != null) {
			l = !1, d = "" + (c.rawNumbers && g.t == "n" ? g.v : Ir(g, null, c));
			for (var _ = 0, v = 0; _ !== d.length; ++_) if ((v = d.charCodeAt(_)) === i || v === a || v === 10 || v === 13 || v === 34 || c.forceQuotes) {
				d = "\"" + d.replace(ug, "\"\"") + "\"";
				break;
			}
			d == "ID" && s == 0 && u.length == 0 && (d = "\"ID\"");
		} else g.f != null && !g.F ? (l = !1, d = "=" + g.f, d.indexOf(",") >= 0 && (d = "\"" + d.replace(ug, "\"\"") + "\"")) : d = "";
		u.push(d);
	}
	if (c.strip) for (; u[u.length - 1] === "";) --u.length;
	return c.blankrows === !1 && l ? null : u.join(o);
}
function fg(e, t) {
	var n = [], r = t == null ? {} : t;
	if (e == null || e["!ref"] == null) return "";
	for (var i = Pr(e["!ref"]), a = r.FS === void 0 ? "," : r.FS, o = a.charCodeAt(0), s = r.RS === void 0 ? "\n" : r.RS, c = s.charCodeAt(0), l = "", u = [], d = r.skipHidden && e["!cols"] || [], f = r.skipHidden && e["!rows"] || [], p = i.s.c; p <= i.e.c; ++p) (d[p] || {}).hidden || (u[p] = Dr(p));
	for (var m = 0, h = i.s.r; h <= i.e.r; ++h) (f[h] || {}).hidden || (l = dg(e, i, h, u, o, c, a, m, r), l != null && (l || r.blankrows !== !1) && n.push((m++ ? s : "") + l));
	return n.join("");
}
function pg(e, t) {
	t || (t = {}), t.FS = "	", t.RS = "\n";
	var n = fg(e, t);
	return r === void 0 || t.type == "string" ? n : "ÿþ" + r.utils.encode(1200, n, "str");
}
function mg(e, t) {
	var n = "", r, i = "";
	if (e == null || e["!ref"] == null) return [];
	var a = Pr(e["!ref"]), o = "", s = [], c, l = [], u = e["!data"] != null;
	for (c = a.s.c; c <= a.e.c; ++c) s[c] = Dr(c);
	for (var d = a.s.r; d <= a.e.r; ++d) for (o = Cr(d), c = a.s.c; c <= a.e.c; ++c) if (n = s[c] + o, r = u ? (e["!data"][d] || [])[c] : e[n], i = "", r !== void 0) {
		if (r.F != null) {
			if (n = r.F, !r.f) continue;
			i = r.f, n.indexOf(":") == -1 && (n = n + ":" + n);
		}
		if (r.f != null) i = r.f;
		else if (t && t.values === !1) continue;
		else if (r.t == "z") continue;
		else if (r.t == "n" && r.v != null) i = "" + r.v;
		else if (r.t == "b") i = r.v ? "TRUE" : "FALSE";
		else if (r.w !== void 0) i = "'" + r.w;
		else if (r.v === void 0) continue;
		else i = r.t == "s" ? "'" + r.v : "" + r.v;
		l[l.length] = n + "=" + i;
	}
	return l;
}
function hg(e, t, n) {
	var r = n || {}, i = e ? e["!data"] != null : r.dense;
	_ != null && i == null && (i = _);
	var a = +!r.skipHeader, o = e || {};
	!e && i && (o["!data"] = []);
	var s = 0, c = 0;
	if (o && r.origin != null) if (typeof r.origin == "number") s = r.origin;
	else {
		var l = typeof r.origin == "string" ? jr(r.origin) : r.origin;
		s = l.r, c = l.c;
	}
	var u = {
		s: {
			c: 0,
			r: 0
		},
		e: {
			c,
			r: s + t.length - 1 + a
		}
	};
	if (o["!ref"]) {
		var d = Pr(o["!ref"]);
		u.e.c = Math.max(u.e.c, d.e.c), u.e.r = Math.max(u.e.r, d.e.r), s == -1 && (s = d.e.r + 1, u.e.r = s + t.length - 1 + a);
	} else s == -1 && (s = 0, u.e.r = t.length - 1 + a);
	var f = r.header || [], p = 0, m = [];
	t.forEach(function(e, t) {
		i && !o["!data"][s + t + a] && (o["!data"][s + t + a] = []), i && (m = o["!data"][s + t + a]), rt(e).forEach(function(n) {
			(p = f.indexOf(n)) == -1 && (f[p = f.length] = n);
			var l = e[n], u = "z", d = "", h = i ? "" : Dr(c + p) + Cr(s + t + a), g = i ? m[c + p] : o[h];
			l && typeof l == "object" && !(l instanceof Date) ? i ? m[c + p] = l : o[h] = l : (typeof l == "number" ? u = "n" : typeof l == "boolean" ? u = "b" : typeof l == "string" ? u = "s" : l instanceof Date ? (u = "d", r.UTC || (l = kt(l)), r.cellDates || (u = "n", l = ct(l)), d = g != null && g.z && ze(g.z) ? g.z : r.dateNF || V[14]) : l === null && r.nullError && (u = "e", l = 0), g ? (g.t = u, g.v = l, delete g.w, delete g.R, d && (g.z = d)) : i ? m[c + p] = g = {
				t: u,
				v: l
			} : o[h] = g = {
				t: u,
				v: l
			}, d && (g.z = d));
		});
	}), u.e.c = Math.max(u.e.c, c + f.length - 1);
	var h = Cr(s);
	if (i && !o["!data"][s] && (o["!data"][s] = []), a) for (p = 0; p < f.length; ++p) i ? o["!data"][s][p + c] = {
		t: "s",
		v: f[p]
	} : o[Dr(p + c) + h] = {
		t: "s",
		v: f[p]
	};
	return o["!ref"] = X(u), o;
}
function gg(e, t) {
	return hg(null, e, t);
}
function _g(e, t, n) {
	if (typeof t == "string") {
		if (e["!data"] != null) {
			var r = jr(t);
			return e["!data"][r.r] || (e["!data"][r.r] = []), e["!data"][r.r][r.c] || (e["!data"][r.r][r.c] = { t: "z" });
		}
		return e[t] || (e[t] = { t: "z" });
	}
	return typeof t == "number" ? _g(e, Dr(n || 0) + Cr(t)) : _g(e, Y(t));
}
function vg(e, t) {
	if (typeof t == "number") {
		if (t >= 0 && e.SheetNames.length > t) return t;
		throw Error("Cannot find sheet # " + t);
	} else if (typeof t == "string") {
		var n = e.SheetNames.indexOf(t);
		if (n > -1) return n;
		throw Error("Cannot find sheet name |" + t + "|");
	} else throw Error("Cannot find sheet |" + t + "|");
}
function yg(e, t) {
	var n = {
		SheetNames: [],
		Sheets: {}
	};
	return e && bg(n, e, t || "Sheet1"), n;
}
function bg(e, t, n, r) {
	var i = 1;
	if (!n) for (; i <= 65535 && e.SheetNames.indexOf(n = "Sheet" + i) != -1; ++i, n = void 0);
	if (!n || e.SheetNames.length >= 65535) throw Error("Too many worksheets");
	if (r && e.SheetNames.indexOf(n) >= 0 && n.length < 32) {
		var a = n.match(/\d+$/);
		i = a && +a[0] || 0;
		var o = a && n.slice(0, a.index) || n;
		for (++i; i <= 65535 && e.SheetNames.indexOf(n = o + i) != -1; ++i);
	}
	if (Tp(n), e.SheetNames.indexOf(n) >= 0) throw Error("Worksheet with name |" + n + "| already exists!");
	return e.SheetNames.push(n), e.Sheets[n] = t, n;
}
function xg(e, t, n) {
	e.Workbook || (e.Workbook = {}), e.Workbook.Sheets || (e.Workbook.Sheets = []);
	var r = vg(e, t);
	switch (e.Workbook.Sheets[r] || (e.Workbook.Sheets[r] = {}), n) {
		case 0:
		case 1:
		case 2: break;
		default: throw Error("Bad sheet visibility setting " + n);
	}
	e.Workbook.Sheets[r].Hidden = n;
}
function Sg(e, t) {
	return e.z = t, e;
}
function Cg(e, t, n) {
	return t ? (e.l = { Target: t }, n && (e.l.Tooltip = n)) : delete e.l, e;
}
function wg(e, t, n) {
	return Cg(e, "#" + t, n);
}
function Tg(e, t, n) {
	e.c || (e.c = []), e.c.push({
		t,
		a: n || "SheetJS"
	});
}
function Eg(e, t, n, r) {
	for (var i = typeof t == "string" ? Pr(t) : t, a = typeof t == "string" ? t : X(t), o = i.s.r; o <= i.e.r; ++o) for (var s = i.s.c; s <= i.e.c; ++s) {
		var c = _g(e, o, s);
		c.t = "n", c.F = a, delete c.v, o == i.s.r && s == i.s.c && (c.f = n, r && (c.D = !0));
	}
	var l = Mr(e["!ref"]);
	return l.s.r > i.s.r && (l.s.r = i.s.r), l.s.c > i.s.c && (l.s.c = i.s.c), l.e.r < i.e.r && (l.e.r = i.e.r), l.e.c < i.e.c && (l.e.c = i.e.c), e["!ref"] = X(l), e;
}
var Dg = {
	encode_col: Dr,
	encode_row: Cr,
	encode_cell: Y,
	encode_range: X,
	decode_col: Er,
	decode_row: Sr,
	split_cell: Ar,
	decode_cell: jr,
	decode_range: Mr,
	format_cell: Ir,
	sheet_new: Rr,
	sheet_add_aoa: zr,
	sheet_add_json: hg,
	sheet_add_dom: ih,
	aoa_to_sheet: Br,
	json_to_sheet: gg,
	table_to_sheet: ah,
	table_to_book: oh,
	sheet_to_csv: fg,
	sheet_to_txt: pg,
	sheet_to_json: lg,
	sheet_to_html: rh,
	sheet_to_formulae: mg,
	sheet_to_row_object_array: lg,
	validate_merges: cf,
	measure_text_width: Ec,
	auto_fit_columns: Nc,
	autofit_columns: Nc,
	col_width_to_px: lc,
	px_to_col_width: function(e) {
		return dc(uc(e));
	},
	row_height_to_px: Lc,
	px_to_row_height: Rc,
	sheet_get_cell: _g,
	book_new: yg,
	book_append_sheet: bg,
	book_set_sheet_visibility: xg,
	cell_set_number_format: Sg,
	cell_set_hyperlink: Cg,
	cell_set_internal_link: wg,
	cell_add_comment: Tg,
	sheet_set_array_formula: Eg,
	consts: {
		SHEET_VISIBLE: 0,
		SHEET_HIDDEN: 1,
		SHEET_VERY_HIDDEN: 2
	}
};
e.version;
//#endregion
//#region node_modules/.pnpm/tinycolor2@1.6.0/node_modules/tinycolor2/esm/tinycolor.js
function Og(e) {
	"@babel/helpers - typeof";
	return Og = typeof Symbol == "function" && typeof Symbol.iterator == "symbol" ? function(e) {
		return typeof e;
	} : function(e) {
		return e && typeof Symbol == "function" && e.constructor === Symbol && e !== Symbol.prototype ? "symbol" : typeof e;
	}, Og(e);
}
var kg = /^\s+/, Ag = /\s+$/;
function Q(e, t) {
	if (e = e || "", t = t || {}, e instanceof Q) return e;
	if (!(this instanceof Q)) return new Q(e, t);
	var n = jg(e);
	this._originalInput = e, this._r = n.r, this._g = n.g, this._b = n.b, this._a = n.a, this._roundA = Math.round(100 * this._a) / 100, this._format = t.format || n.format, this._gradientType = t.gradientType, this._r < 1 && (this._r = Math.round(this._r)), this._g < 1 && (this._g = Math.round(this._g)), this._b < 1 && (this._b = Math.round(this._b)), this._ok = n.ok;
}
Q.prototype = {
	isDark: function() {
		return this.getBrightness() < 128;
	},
	isLight: function() {
		return !this.isDark();
	},
	isValid: function() {
		return this._ok;
	},
	getOriginalInput: function() {
		return this._originalInput;
	},
	getFormat: function() {
		return this._format;
	},
	getAlpha: function() {
		return this._a;
	},
	getBrightness: function() {
		var e = this.toRgb();
		return (e.r * 299 + e.g * 587 + e.b * 114) / 1e3;
	},
	getLuminance: function() {
		var e = this.toRgb(), t = e.r / 255, n = e.g / 255, r = e.b / 255, i = t <= .03928 ? t / 12.92 : ((t + .055) / 1.055) ** 2.4, a = n <= .03928 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4, o = r <= .03928 ? r / 12.92 : ((r + .055) / 1.055) ** 2.4;
		return .2126 * i + .7152 * a + .0722 * o;
	},
	setAlpha: function(e) {
		return this._a = t_(e), this._roundA = Math.round(100 * this._a) / 100, this;
	},
	toHsv: function() {
		var e = Fg(this._r, this._g, this._b);
		return {
			h: e.h * 360,
			s: e.s,
			v: e.v,
			a: this._a
		};
	},
	toHsvString: function() {
		var e = Fg(this._r, this._g, this._b), t = Math.round(e.h * 360), n = Math.round(e.s * 100), r = Math.round(e.v * 100);
		return this._a == 1 ? "hsv(" + t + ", " + n + "%, " + r + "%)" : "hsva(" + t + ", " + n + "%, " + r + "%, " + this._roundA + ")";
	},
	toHsl: function() {
		var e = Ng(this._r, this._g, this._b);
		return {
			h: e.h * 360,
			s: e.s,
			l: e.l,
			a: this._a
		};
	},
	toHslString: function() {
		var e = Ng(this._r, this._g, this._b), t = Math.round(e.h * 360), n = Math.round(e.s * 100), r = Math.round(e.l * 100);
		return this._a == 1 ? "hsl(" + t + ", " + n + "%, " + r + "%)" : "hsla(" + t + ", " + n + "%, " + r + "%, " + this._roundA + ")";
	},
	toHex: function(e) {
		return Lg(this._r, this._g, this._b, e);
	},
	toHexString: function(e) {
		return "#" + this.toHex(e);
	},
	toHex8: function(e) {
		return Rg(this._r, this._g, this._b, this._a, e);
	},
	toHex8String: function(e) {
		return "#" + this.toHex8(e);
	},
	toRgb: function() {
		return {
			r: Math.round(this._r),
			g: Math.round(this._g),
			b: Math.round(this._b),
			a: this._a
		};
	},
	toRgbString: function() {
		return this._a == 1 ? "rgb(" + Math.round(this._r) + ", " + Math.round(this._g) + ", " + Math.round(this._b) + ")" : "rgba(" + Math.round(this._r) + ", " + Math.round(this._g) + ", " + Math.round(this._b) + ", " + this._roundA + ")";
	},
	toPercentageRgb: function() {
		return {
			r: Math.round(n_(this._r, 255) * 100) + "%",
			g: Math.round(n_(this._g, 255) * 100) + "%",
			b: Math.round(n_(this._b, 255) * 100) + "%",
			a: this._a
		};
	},
	toPercentageRgbString: function() {
		return this._a == 1 ? "rgb(" + Math.round(n_(this._r, 255) * 100) + "%, " + Math.round(n_(this._g, 255) * 100) + "%, " + Math.round(n_(this._b, 255) * 100) + "%)" : "rgba(" + Math.round(n_(this._r, 255) * 100) + "%, " + Math.round(n_(this._g, 255) * 100) + "%, " + Math.round(n_(this._b, 255) * 100) + "%, " + this._roundA + ")";
	},
	toName: function() {
		return this._a === 0 ? "transparent" : this._a < 1 ? !1 : $g[Lg(this._r, this._g, this._b, !0)] || !1;
	},
	toFilter: function(e) {
		var t = "#" + zg(this._r, this._g, this._b, this._a), n = t, r = this._gradientType ? "GradientType = 1, " : "";
		if (e) {
			var i = Q(e);
			n = "#" + zg(i._r, i._g, i._b, i._a);
		}
		return "progid:DXImageTransform.Microsoft.gradient(" + r + "startColorstr=" + t + ",endColorstr=" + n + ")";
	},
	toString: function(e) {
		var t = !!e;
		e = e || this._format;
		var n = !1, r = this._a < 1 && this._a >= 0;
		return !t && r && (e === "hex" || e === "hex6" || e === "hex3" || e === "hex4" || e === "hex8" || e === "name") ? e === "name" && this._a === 0 ? this.toName() : this.toRgbString() : (e === "rgb" && (n = this.toRgbString()), e === "prgb" && (n = this.toPercentageRgbString()), (e === "hex" || e === "hex6") && (n = this.toHexString()), e === "hex3" && (n = this.toHexString(!0)), e === "hex4" && (n = this.toHex8String(!0)), e === "hex8" && (n = this.toHex8String()), e === "name" && (n = this.toName()), e === "hsl" && (n = this.toHslString()), e === "hsv" && (n = this.toHsvString()), n || this.toHexString());
	},
	clone: function() {
		return Q(this.toString());
	},
	_applyModification: function(e, t) {
		var n = e.apply(null, [this].concat([].slice.call(t)));
		return this._r = n._r, this._g = n._g, this._b = n._b, this.setAlpha(n._a), this;
	},
	lighten: function() {
		return this._applyModification(Ug, arguments);
	},
	brighten: function() {
		return this._applyModification(Wg, arguments);
	},
	darken: function() {
		return this._applyModification(Gg, arguments);
	},
	desaturate: function() {
		return this._applyModification(Bg, arguments);
	},
	saturate: function() {
		return this._applyModification(Vg, arguments);
	},
	greyscale: function() {
		return this._applyModification(Hg, arguments);
	},
	spin: function() {
		return this._applyModification(Kg, arguments);
	},
	_applyCombination: function(e, t) {
		return e.apply(null, [this].concat([].slice.call(t)));
	},
	analogous: function() {
		return this._applyCombination(Xg, arguments);
	},
	complement: function() {
		return this._applyCombination(qg, arguments);
	},
	monochromatic: function() {
		return this._applyCombination(Zg, arguments);
	},
	splitcomplement: function() {
		return this._applyCombination(Yg, arguments);
	},
	triad: function() {
		return this._applyCombination(Jg, [3]);
	},
	tetrad: function() {
		return this._applyCombination(Jg, [4]);
	}
}, Q.fromRatio = function(e, t) {
	if (Og(e) == "object") {
		var n = {};
		for (var r in e) e.hasOwnProperty(r) && (r === "a" ? n[r] = e[r] : n[r] = c_(e[r]));
		e = n;
	}
	return Q(e, t);
};
function jg(e) {
	var t = {
		r: 0,
		g: 0,
		b: 0
	}, n = 1, r = null, i = null, a = null, o = !1, s = !1;
	return typeof e == "string" && (e = p_(e)), Og(e) == "object" && (f_(e.r) && f_(e.g) && f_(e.b) ? (t = Mg(e.r, e.g, e.b), o = !0, s = String(e.r).substr(-1) === "%" ? "prgb" : "rgb") : f_(e.h) && f_(e.s) && f_(e.v) ? (r = c_(e.s), i = c_(e.v), t = Ig(e.h, r, i), o = !0, s = "hsv") : f_(e.h) && f_(e.s) && f_(e.l) && (r = c_(e.s), a = c_(e.l), t = Pg(e.h, r, a), o = !0, s = "hsl"), e.hasOwnProperty("a") && (n = e.a)), n = t_(n), {
		ok: o,
		format: e.format || s,
		r: Math.min(255, Math.max(t.r, 0)),
		g: Math.min(255, Math.max(t.g, 0)),
		b: Math.min(255, Math.max(t.b, 0)),
		a: n
	};
}
function Mg(e, t, n) {
	return {
		r: n_(e, 255) * 255,
		g: n_(t, 255) * 255,
		b: n_(n, 255) * 255
	};
}
function Ng(e, t, n) {
	e = n_(e, 255), t = n_(t, 255), n = n_(n, 255);
	var r = Math.max(e, t, n), i = Math.min(e, t, n), a, o, s = (r + i) / 2;
	if (r == i) a = o = 0;
	else {
		var c = r - i;
		switch (o = s > .5 ? c / (2 - r - i) : c / (r + i), r) {
			case e:
				a = (t - n) / c + (t < n ? 6 : 0);
				break;
			case t:
				a = (n - e) / c + 2;
				break;
			case n:
				a = (e - t) / c + 4;
				break;
		}
		a /= 6;
	}
	return {
		h: a,
		s: o,
		l: s
	};
}
function Pg(e, t, n) {
	var r, i, a;
	e = n_(e, 360), t = n_(t, 100), n = n_(n, 100);
	function o(e, t, n) {
		return n < 0 && (n += 1), n > 1 && --n, n < 1 / 6 ? e + (t - e) * 6 * n : n < 1 / 2 ? t : n < 2 / 3 ? e + (t - e) * (2 / 3 - n) * 6 : e;
	}
	if (t === 0) r = i = a = n;
	else {
		var s = n < .5 ? n * (1 + t) : n + t - n * t, c = 2 * n - s;
		r = o(c, s, e + 1 / 3), i = o(c, s, e), a = o(c, s, e - 1 / 3);
	}
	return {
		r: r * 255,
		g: i * 255,
		b: a * 255
	};
}
function Fg(e, t, n) {
	e = n_(e, 255), t = n_(t, 255), n = n_(n, 255);
	var r = Math.max(e, t, n), i = Math.min(e, t, n), a, o, s = r, c = r - i;
	if (o = r === 0 ? 0 : c / r, r == i) a = 0;
	else {
		switch (r) {
			case e:
				a = (t - n) / c + (t < n ? 6 : 0);
				break;
			case t:
				a = (n - e) / c + 2;
				break;
			case n:
				a = (e - t) / c + 4;
				break;
		}
		a /= 6;
	}
	return {
		h: a,
		s: o,
		v: s
	};
}
function Ig(e, t, n) {
	e = n_(e, 360) * 6, t = n_(t, 100), n = n_(n, 100);
	var r = Math.floor(e), i = e - r, a = n * (1 - t), o = n * (1 - i * t), s = n * (1 - (1 - i) * t), c = r % 6, l = [
		n,
		o,
		a,
		a,
		s,
		n
	][c], u = [
		s,
		n,
		n,
		o,
		a,
		a
	][c], d = [
		a,
		a,
		s,
		n,
		n,
		o
	][c];
	return {
		r: l * 255,
		g: u * 255,
		b: d * 255
	};
}
function Lg(e, t, n, r) {
	var i = [
		s_(Math.round(e).toString(16)),
		s_(Math.round(t).toString(16)),
		s_(Math.round(n).toString(16))
	];
	return r && i[0].charAt(0) == i[0].charAt(1) && i[1].charAt(0) == i[1].charAt(1) && i[2].charAt(0) == i[2].charAt(1) ? i[0].charAt(0) + i[1].charAt(0) + i[2].charAt(0) : i.join("");
}
function Rg(e, t, n, r, i) {
	var a = [
		s_(Math.round(e).toString(16)),
		s_(Math.round(t).toString(16)),
		s_(Math.round(n).toString(16)),
		s_(l_(r))
	];
	return i && a[0].charAt(0) == a[0].charAt(1) && a[1].charAt(0) == a[1].charAt(1) && a[2].charAt(0) == a[2].charAt(1) && a[3].charAt(0) == a[3].charAt(1) ? a[0].charAt(0) + a[1].charAt(0) + a[2].charAt(0) + a[3].charAt(0) : a.join("");
}
function zg(e, t, n, r) {
	return [
		s_(l_(r)),
		s_(Math.round(e).toString(16)),
		s_(Math.round(t).toString(16)),
		s_(Math.round(n).toString(16))
	].join("");
}
Q.equals = function(e, t) {
	return !e || !t ? !1 : Q(e).toRgbString() == Q(t).toRgbString();
}, Q.random = function() {
	return Q.fromRatio({
		r: Math.random(),
		g: Math.random(),
		b: Math.random()
	});
};
function Bg(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = Q(e).toHsl();
	return n.s -= t / 100, n.s = r_(n.s), Q(n);
}
function Vg(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = Q(e).toHsl();
	return n.s += t / 100, n.s = r_(n.s), Q(n);
}
function Hg(e) {
	return Q(e).desaturate(100);
}
function Ug(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = Q(e).toHsl();
	return n.l += t / 100, n.l = r_(n.l), Q(n);
}
function Wg(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = Q(e).toRgb();
	return n.r = Math.max(0, Math.min(255, n.r - Math.round(255 * -(t / 100)))), n.g = Math.max(0, Math.min(255, n.g - Math.round(255 * -(t / 100)))), n.b = Math.max(0, Math.min(255, n.b - Math.round(255 * -(t / 100)))), Q(n);
}
function Gg(e, t) {
	t = t === 0 ? 0 : t || 10;
	var n = Q(e).toHsl();
	return n.l -= t / 100, n.l = r_(n.l), Q(n);
}
function Kg(e, t) {
	var n = Q(e).toHsl(), r = (n.h + t) % 360;
	return n.h = r < 0 ? 360 + r : r, Q(n);
}
function qg(e) {
	var t = Q(e).toHsl();
	return t.h = (t.h + 180) % 360, Q(t);
}
function Jg(e, t) {
	if (isNaN(t) || t <= 0) throw Error("Argument to polyad must be a positive number");
	for (var n = Q(e).toHsl(), r = [Q(e)], i = 360 / t, a = 1; a < t; a++) r.push(Q({
		h: (n.h + a * i) % 360,
		s: n.s,
		l: n.l
	}));
	return r;
}
function Yg(e) {
	var t = Q(e).toHsl(), n = t.h;
	return [
		Q(e),
		Q({
			h: (n + 72) % 360,
			s: t.s,
			l: t.l
		}),
		Q({
			h: (n + 216) % 360,
			s: t.s,
			l: t.l
		})
	];
}
function Xg(e, t, n) {
	t = t || 6, n = n || 30;
	var r = Q(e).toHsl(), i = 360 / n, a = [Q(e)];
	for (r.h = (r.h - (i * t >> 1) + 720) % 360; --t;) r.h = (r.h + i) % 360, a.push(Q(r));
	return a;
}
function Zg(e, t) {
	t = t || 6;
	for (var n = Q(e).toHsv(), r = n.h, i = n.s, a = n.v, o = [], s = 1 / t; t--;) o.push(Q({
		h: r,
		s: i,
		v: a
	})), a = (a + s) % 1;
	return o;
}
Q.mix = function(e, t, n) {
	n = n === 0 ? 0 : n || 50;
	var r = Q(e).toRgb(), i = Q(t).toRgb(), a = n / 100;
	return Q({
		r: (i.r - r.r) * a + r.r,
		g: (i.g - r.g) * a + r.g,
		b: (i.b - r.b) * a + r.b,
		a: (i.a - r.a) * a + r.a
	});
}, Q.readability = function(e, t) {
	var n = Q(e), r = Q(t);
	return (Math.max(n.getLuminance(), r.getLuminance()) + .05) / (Math.min(n.getLuminance(), r.getLuminance()) + .05);
}, Q.isReadable = function(e, t, n) {
	var r = Q.readability(e, t), i, a = !1;
	switch (i = m_(n), i.level + i.size) {
		case "AAsmall":
		case "AAAlarge":
			a = r >= 4.5;
			break;
		case "AAlarge":
			a = r >= 3;
			break;
		case "AAAsmall":
			a = r >= 7;
			break;
	}
	return a;
}, Q.mostReadable = function(e, t, n) {
	var r = null, i = 0, a, o, s, c;
	n = n || {}, o = n.includeFallbackColors, s = n.level, c = n.size;
	for (var l = 0; l < t.length; l++) a = Q.readability(e, t[l]), a > i && (i = a, r = Q(t[l]));
	return Q.isReadable(e, r, {
		level: s,
		size: c
	}) || !o ? r : (n.includeFallbackColors = !1, Q.mostReadable(e, ["#fff", "#000"], n));
};
var Qg = Q.names = {
	aliceblue: "f0f8ff",
	antiquewhite: "faebd7",
	aqua: "0ff",
	aquamarine: "7fffd4",
	azure: "f0ffff",
	beige: "f5f5dc",
	bisque: "ffe4c4",
	black: "000",
	blanchedalmond: "ffebcd",
	blue: "00f",
	blueviolet: "8a2be2",
	brown: "a52a2a",
	burlywood: "deb887",
	burntsienna: "ea7e5d",
	cadetblue: "5f9ea0",
	chartreuse: "7fff00",
	chocolate: "d2691e",
	coral: "ff7f50",
	cornflowerblue: "6495ed",
	cornsilk: "fff8dc",
	crimson: "dc143c",
	cyan: "0ff",
	darkblue: "00008b",
	darkcyan: "008b8b",
	darkgoldenrod: "b8860b",
	darkgray: "a9a9a9",
	darkgreen: "006400",
	darkgrey: "a9a9a9",
	darkkhaki: "bdb76b",
	darkmagenta: "8b008b",
	darkolivegreen: "556b2f",
	darkorange: "ff8c00",
	darkorchid: "9932cc",
	darkred: "8b0000",
	darksalmon: "e9967a",
	darkseagreen: "8fbc8f",
	darkslateblue: "483d8b",
	darkslategray: "2f4f4f",
	darkslategrey: "2f4f4f",
	darkturquoise: "00ced1",
	darkviolet: "9400d3",
	deeppink: "ff1493",
	deepskyblue: "00bfff",
	dimgray: "696969",
	dimgrey: "696969",
	dodgerblue: "1e90ff",
	firebrick: "b22222",
	floralwhite: "fffaf0",
	forestgreen: "228b22",
	fuchsia: "f0f",
	gainsboro: "dcdcdc",
	ghostwhite: "f8f8ff",
	gold: "ffd700",
	goldenrod: "daa520",
	gray: "808080",
	green: "008000",
	greenyellow: "adff2f",
	grey: "808080",
	honeydew: "f0fff0",
	hotpink: "ff69b4",
	indianred: "cd5c5c",
	indigo: "4b0082",
	ivory: "fffff0",
	khaki: "f0e68c",
	lavender: "e6e6fa",
	lavenderblush: "fff0f5",
	lawngreen: "7cfc00",
	lemonchiffon: "fffacd",
	lightblue: "add8e6",
	lightcoral: "f08080",
	lightcyan: "e0ffff",
	lightgoldenrodyellow: "fafad2",
	lightgray: "d3d3d3",
	lightgreen: "90ee90",
	lightgrey: "d3d3d3",
	lightpink: "ffb6c1",
	lightsalmon: "ffa07a",
	lightseagreen: "20b2aa",
	lightskyblue: "87cefa",
	lightslategray: "789",
	lightslategrey: "789",
	lightsteelblue: "b0c4de",
	lightyellow: "ffffe0",
	lime: "0f0",
	limegreen: "32cd32",
	linen: "faf0e6",
	magenta: "f0f",
	maroon: "800000",
	mediumaquamarine: "66cdaa",
	mediumblue: "0000cd",
	mediumorchid: "ba55d3",
	mediumpurple: "9370db",
	mediumseagreen: "3cb371",
	mediumslateblue: "7b68ee",
	mediumspringgreen: "00fa9a",
	mediumturquoise: "48d1cc",
	mediumvioletred: "c71585",
	midnightblue: "191970",
	mintcream: "f5fffa",
	mistyrose: "ffe4e1",
	moccasin: "ffe4b5",
	navajowhite: "ffdead",
	navy: "000080",
	oldlace: "fdf5e6",
	olive: "808000",
	olivedrab: "6b8e23",
	orange: "ffa500",
	orangered: "ff4500",
	orchid: "da70d6",
	palegoldenrod: "eee8aa",
	palegreen: "98fb98",
	paleturquoise: "afeeee",
	palevioletred: "db7093",
	papayawhip: "ffefd5",
	peachpuff: "ffdab9",
	peru: "cd853f",
	pink: "ffc0cb",
	plum: "dda0dd",
	powderblue: "b0e0e6",
	purple: "800080",
	rebeccapurple: "663399",
	red: "f00",
	rosybrown: "bc8f8f",
	royalblue: "4169e1",
	saddlebrown: "8b4513",
	salmon: "fa8072",
	sandybrown: "f4a460",
	seagreen: "2e8b57",
	seashell: "fff5ee",
	sienna: "a0522d",
	silver: "c0c0c0",
	skyblue: "87ceeb",
	slateblue: "6a5acd",
	slategray: "708090",
	slategrey: "708090",
	snow: "fffafa",
	springgreen: "00ff7f",
	steelblue: "4682b4",
	tan: "d2b48c",
	teal: "008080",
	thistle: "d8bfd8",
	tomato: "ff6347",
	turquoise: "40e0d0",
	violet: "ee82ee",
	wheat: "f5deb3",
	white: "fff",
	whitesmoke: "f5f5f5",
	yellow: "ff0",
	yellowgreen: "9acd32"
}, $g = Q.hexNames = e_(Qg);
function e_(e) {
	var t = {};
	for (var n in e) e.hasOwnProperty(n) && (t[e[n]] = n);
	return t;
}
function t_(e) {
	return e = parseFloat(e), (isNaN(e) || e < 0 || e > 1) && (e = 1), e;
}
function n_(e, t) {
	a_(e) && (e = "100%");
	var n = o_(e);
	return e = Math.min(t, Math.max(0, parseFloat(e))), n && (e = parseInt(e * t, 10) / 100), Math.abs(e - t) < 1e-6 ? 1 : e % t / parseFloat(t);
}
function r_(e) {
	return Math.min(1, Math.max(0, e));
}
function i_(e) {
	return parseInt(e, 16);
}
function a_(e) {
	return typeof e == "string" && e.indexOf(".") != -1 && parseFloat(e) === 1;
}
function o_(e) {
	return typeof e == "string" && e.indexOf("%") != -1;
}
function s_(e) {
	return e.length == 1 ? "0" + e : "" + e;
}
function c_(e) {
	return e <= 1 && (e = e * 100 + "%"), e;
}
function l_(e) {
	return Math.round(parseFloat(e) * 255).toString(16);
}
function u_(e) {
	return i_(e) / 255;
}
var d_ = function() {
	var e = "(?:[-\\+]?\\d*\\.\\d+%?)|(?:[-\\+]?\\d+%?)", t = "[\\s|\\(]+(" + e + ")[,|\\s]+(" + e + ")[,|\\s]+(" + e + ")\\s*\\)?", n = "[\\s|\\(]+(" + e + ")[,|\\s]+(" + e + ")[,|\\s]+(" + e + ")[,|\\s]+(" + e + ")\\s*\\)?";
	return {
		CSS_UNIT: new RegExp(e),
		rgb: RegExp("rgb" + t),
		rgba: RegExp("rgba" + n),
		hsl: RegExp("hsl" + t),
		hsla: RegExp("hsla" + n),
		hsv: RegExp("hsv" + t),
		hsva: RegExp("hsva" + n),
		hex3: /^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
		hex6: /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/,
		hex4: /^#?([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
		hex8: /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/
	};
}();
function f_(e) {
	return !!d_.CSS_UNIT.exec(e);
}
function p_(e) {
	e = e.replace(kg, "").replace(Ag, "").toLowerCase();
	var t = !1;
	if (Qg[e]) e = Qg[e], t = !0;
	else if (e == "transparent") return {
		r: 0,
		g: 0,
		b: 0,
		a: 0,
		format: "name"
	};
	var n;
	return (n = d_.rgb.exec(e)) ? {
		r: n[1],
		g: n[2],
		b: n[3]
	} : (n = d_.rgba.exec(e)) ? {
		r: n[1],
		g: n[2],
		b: n[3],
		a: n[4]
	} : (n = d_.hsl.exec(e)) ? {
		h: n[1],
		s: n[2],
		l: n[3]
	} : (n = d_.hsla.exec(e)) ? {
		h: n[1],
		s: n[2],
		l: n[3],
		a: n[4]
	} : (n = d_.hsv.exec(e)) ? {
		h: n[1],
		s: n[2],
		v: n[3]
	} : (n = d_.hsva.exec(e)) ? {
		h: n[1],
		s: n[2],
		v: n[3],
		a: n[4]
	} : (n = d_.hex8.exec(e)) ? {
		r: i_(n[1]),
		g: i_(n[2]),
		b: i_(n[3]),
		a: u_(n[4]),
		format: t ? "name" : "hex8"
	} : (n = d_.hex6.exec(e)) ? {
		r: i_(n[1]),
		g: i_(n[2]),
		b: i_(n[3]),
		format: t ? "name" : "hex"
	} : (n = d_.hex4.exec(e)) ? {
		r: i_(n[1] + "" + n[1]),
		g: i_(n[2] + "" + n[2]),
		b: i_(n[3] + "" + n[3]),
		a: u_(n[4] + "" + n[4]),
		format: t ? "name" : "hex8"
	} : (n = d_.hex3.exec(e)) ? {
		r: i_(n[1] + "" + n[1]),
		g: i_(n[2] + "" + n[2]),
		b: i_(n[3] + "" + n[3]),
		format: t ? "name" : "hex"
	} : !1;
}
function m_(e) {
	var t, n;
	return e = e || {
		level: "AA",
		size: "small"
	}, t = (e.level || "AA").toUpperCase(), n = (e.size || "small").toLowerCase(), t !== "AA" && t !== "AAA" && (t = "AA"), n !== "small" && n !== "large" && (n = "small"), {
		level: t,
		size: n
	};
}
//#endregion
//#region packages/core/src/renderers/spreadsheet/worker/sheetjs/color.ts
var h_ = /* @__PURE__ */ "FF000000.FFFFFFFF.FFFF0000.FF00FF00.FF0000FF.FFFFFF00.FFFF00FF.FF00FFFF.FF000000.FFFFFFFF.FFFF0000.FF00FF00.FF0000FF.FFFFFF00.FFFF00FF.FF00FFFF.FF800000.FF008000.FF000080.FF808000.FF800080.FF008080.FFC0C0C0.FF808080.FF9999FF.FF993366.FFFFFFCC.FFCCFFFF.FF660066.FFFF8080.FF0066CC.FFCCCCFF.FF000080.FFFF00FF.FFFFFF00.FF00FFFF.FF800080.FF800000.FF008080.FF0000FF.FF00CCFF.FFCCFFFF.FFCCFFCC.FFFFFF99.FF99CCFF.FFFF99CC.FFCC99FF.FFFFCC99.FF3366FF.FF33CCCC.FF99CC00.FFFFCC00.FFFF9900.FFFF6600.FF666699.FF969696.FF003366.FF339966.FF003300.FF333300.FF993300.FF993366.FF333399.FF333333".split("."), g_ = 240, __ = 255;
function v_(e, t, n) {
	let r = Math.max(e, t, n), i = Math.min(e, t, n), a = r + i, o = r - i, s = a / 2, c, l;
	if (i == r) return [
		0,
		s,
		0
	];
	l = s <= .5 ? o / a : o / (2 - a);
	let u = (r - e) / o, d = (r - t) / o, f = (r - n) / o;
	return c = e == r ? f - d : t === r ? 2 + u - f : 4 + d - u, c = c / 6 % 1, [
		c,
		s,
		l
	];
}
function y_(e) {
	e.length > 6 && (e = e.substring(2));
	let [t, n, r] = v_(parseInt(e.slice(0, 2), 16) / __, parseInt(e.slice(2, 4), 16) / __, parseInt(e.slice(4, 6), 16) / __);
	return [
		Math.round(t * g_),
		Math.round(n * g_),
		Math.round(r * g_)
	];
}
function b_(e, t, n) {
	return Q({
		h: e / g_ * 360,
		s: n / g_,
		l: t / g_
	}).toHex().toUpperCase();
}
function x_(e, t) {
	return Math.round(e <= 0 ? t * (1 + e) : t * (1 - e) + (g_ - g_ * (1 - e)));
}
function S_(e, t) {
	if (!e) return e;
	let [n, r, i] = y_(e);
	return `FF${b_(n, x_(t, r), i)}`;
}
//#endregion
//#region packages/core/src/renderers/spreadsheet/worker/sheetjs/SheetJsModel.ts
var C_, w_ = 8.43, T_ = 15, E_ = "#202124", D_ = 9525, O_ = 480, k_ = 288, A_ = 24, j_ = 8, M_ = (e) => typeof e == "number" && Number.isFinite(e) ? e : void 0, N_ = {
	rowHeight: (() => {
		var e;
		let t = Dg.row_height_to_px, n = typeof t == "function" ? t(T_) : void 0;
		return Math.ceil((e = M_(n)) == null ? 20 : e);
	})(),
	colWidth: (() => {
		var e;
		let t = Dg.col_width_to_px, n = typeof t == "function" ? t(w_) : void 0;
		return Math.ceil((e = M_(n)) == null ? 64 : e);
	})()
}, P_ = (e, t) => `${e}-${t}`, F_ = (e) => e ? e.w !== void 0 && e.w !== null ? `${e.w}` : e.v === void 0 || e.v === null ? "" : e.t === "d" && e.v instanceof Date ? e.v.toLocaleDateString() : `${e.v}` : "", I_ = (e) => {
	if (!e) return;
	if (e.hidden) return 0;
	let t = M_(e.wpx);
	if (t !== void 0 && t >= 0) return Math.ceil(t);
	let n = M_(e.width);
	if (n === 0) return 0;
	if (n !== void 0 && n > 0) {
		let t = Dg.col_width_to_px, r = typeof t == "function" ? M_(t(n)) : void 0;
		return Math.ceil(r === void 0 ? n * (e.MDW || 7) : r);
	}
	let r = M_(e.wch);
	if (r === 0) return 0;
	if (r !== void 0 && r > 0) return Math.ceil(r * (e.MDW || 7) + 5);
}, L_ = (e, t, n) => {
	var r;
	return typeof e == "number" ? e : (r = e == null ? void 0 : e[t]) == null ? n : r;
}, R_ = (e) => (e || 0) / D_, z_ = (e) => {
	var t, n, r;
	return e ? e.hidden ? !0 : ((t = M_(e.wpx)) == null ? -1 : t) >= 0 || ((n = M_(e.width)) == null ? -1 : n) >= 0 || ((r = M_(e.wch)) == null ? -1 : r) >= 0 : !1;
}, B_ = (e) => {
	if (!e) return;
	if (e.hidden) return 0;
	let t = M_(e.hpx);
	if (t !== void 0 && t >= 0) return Math.ceil(t);
	let n = M_(e.hpt);
	if (n !== void 0 && n >= 0) {
		let e = Dg.row_height_to_px, t = typeof e == "function" ? M_(e(n)) : void 0;
		return Math.ceil(t == null ? n * 96 / 72 : t);
	}
}, V_ = (e) => {
	switch (`${e || ""}`) {
		case "left": return "Left";
		case "center":
		case "centerContinuous":
		case "distributed":
		case "justify": return "Center";
		case "right": return "Right";
		default: return;
	}
}, H_ = (e) => {
	switch (`${e || ""}`) {
		case "top": return "Top";
		case "center":
		case "middle":
		case "distributed":
		case "justify": return "Middle";
		case "bottom": return "Bottom";
		default: return;
	}
}, U_ = (e) => {
	if (!e) return "";
	let t = [V_(e.horizontal), H_(e.vertical)].filter(Boolean).map((e) => `ht${e}`);
	return e.wrapText && t.push("htWrap"), e.shrinkToFit && t.push("htShrink"), t.join(" ");
}, W_ = (e) => {
	if (!e) return;
	let t = e.raw_rgb && typeof e.tint == "number" ? S_(e.raw_rgb, e.tint) : void 0, n = e.rgb || t || e.raw_rgb;
	if (typeof n == "string" && n) {
		let e = n.startsWith("#") ? n.slice(1) : n;
		return `#${e.length > 6 ? e.slice(-6) : e}`;
	}
	let r = typeof e.indexed == "number" ? e.indexed : e.index;
	if (typeof r == "number") {
		let e = h_[r];
		if (e) return `#${e.slice(-6)}`;
	}
}, G_ = (e) => e ? (typeof e.indexed == "number" ? e.indexed : e.index) === 32767 : !1, K_ = (e) => G_(e) ? E_ : W_(e), q_ = (e) => {
	switch (e) {
		case "hair": return "0.5px";
		case "medium":
		case "mediumDashed":
		case "mediumDashDot":
		case "mediumDashDotDot": return "2px";
		case "thick":
		case "double": return "3px";
		default: return "1px";
	}
}, J_ = (e) => {
	switch (e) {
		case "dashed":
		case "mediumDashed":
		case "dashDot":
		case "mediumDashDot":
		case "dashDotDot":
		case "mediumDashDotDot":
		case "slantDashDot": return "dashed";
		case "dotted": return "dotted";
		case "double": return "double";
		default: return "solid";
	}
}, Y_ = (...e) => {
	let t = {};
	return e.forEach((e) => {
		e && Object.entries(e).forEach(([e, n]) => {
			if (n && typeof n == "object" && !Array.isArray(n)) {
				t[e] = {
					...t[e] && typeof t[e] == "object" ? t[e] : {},
					...n
				};
				return;
			}
			t[e] = n;
		});
	}), Object.keys(t).length ? t : void 0;
}, X_ = (e) => {
	let t = {}, n = (e == null ? void 0 : e.fill) || {}, r = W_((e == null ? void 0 : e.fgColor) || n.fgColor || (e == null ? void 0 : e.bgColor) || n.bgColor), i = (e == null ? void 0 : e.patternType) || n.patternType;
	r && i !== "none" && (t.backgroundColor = r);
	let a = (e == null ? void 0 : e.font) || {}, o = K_(a.color || (e == null ? void 0 : e.color));
	o && (t.color = o), (a.italic || e != null && e.italic) && (t.fontStyle = "italic"), (a.bold || e != null && e.bold) && (t.fontWeight = "bold");
	let s = a.sz || (e == null ? void 0 : e.sz);
	s && (t.fontSize = `${s}px`);
	let c = a.name || (e == null ? void 0 : e.name);
	c && (t.fontFamily = c);
	let l = e == null ? void 0 : e.border;
	return l && [
		"top",
		"right",
		"bottom",
		"left"
	].forEach((e) => {
		let n = l[e];
		if (!(n != null && n.style) || n.style === "none") return;
		let r = `border${e.charAt(0).toUpperCase()}${e.slice(1)}`;
		t[`${r}Width`] = q_(n.style), t[`${r}Style`] = J_(n.style), t[`${r}Color`] = W_(n.color) || "#000000";
	}), Object.keys(t).length ? t : void 0;
}, Z_ = (e, t) => {
	for (let n of e) for (let e = 0; e < t; e += 1) (n[e] === void 0 || n[e] === null) && (n[e] = "");
	return e;
}, Q_ = class e {
	static create(t, n = {}) {
		return new e(t, n);
	}
	constructor(e, t) {
		this._ws = e, this._startRow = Math.max(t.startRow || 0, 0), this._pageSize = Math.max(t.pageSize || 500, 1), this._totalRows = t.totalRows, this._totalCols = t.totalCols;
		let { "!ref": n } = e;
		this.range = Dg.decode_range(n || "A1");
	}
	get ws() {
		return this._ws;
	}
	get defaults() {
		return e.defaults;
	}
	get data() {
		var e;
		return (e = this._data) == null ? this._data = this.getData() : e;
	}
	get cell() {
		var e;
		return (e = this._cell) == null ? this._cell = this.getCell() : e;
	}
	get merge() {
		var e;
		return (e = this._merge) == null ? this._merge = this.getMerge() : e;
	}
	get columns() {
		var e;
		return (e = this._columns) == null ? this._columns = this.getColumns() : e;
	}
	get structure() {
		var e;
		return (e = this._structure) == null ? this._structure = this.getStructure() : e;
	}
	get rowHeights() {
		var e;
		return (e = this._rowHeights) == null ? this._rowHeights = this.getRowHeights() : e;
	}
	get colWidths() {
		var e;
		return (e = this._colWidths) == null ? this._colWidths = this.getColWidths() : e;
	}
	get meta() {
		var e;
		return (e = this._meta) == null ? this._meta = {
			startRow: this.startRow,
			endRow: this.endRow,
			pageSize: this._pageSize,
			totalRows: this.totalRows,
			totalCols: this.totalCols
		} : e;
	}
	get totalRows() {
		var e;
		return (e = this._totalRows) == null ? this.range.e.r + 1 : e;
	}
	get totalCols() {
		var e;
		return (e = this._totalCols) == null ? this.range.e.c + 1 : e;
	}
	get startRow() {
		return Math.min(this._startRow, Math.max(this.totalRows - 1, 0));
	}
	get endRow() {
		return Math.min(this.startRow + this._pageSize, this.totalRows);
	}
	get denseRows() {
		let e = this.ws;
		return Array.isArray(e) ? e : Array.isArray(e["!data"]) ? e["!data"] : void 0;
	}
	getCellAt(e, t) {
		let n = this.denseRows;
		if (n) {
			var r;
			return (r = n[e]) == null ? void 0 : r[t];
		}
		return this.ws[Dg.encode_cell({
			r: e,
			c: t
		})];
	}
	getAxisOffset(e, t, n) {
		let r = 0;
		for (let i = 0; i < e; i += 1) r += L_(t, i, n);
		return r;
	}
	getMarkerLeft(e) {
		return e ? this.getAxisOffset(e.col || 0, this.getColWidths(), this.defaults.colWidth) + R_(e.colOff) : 0;
	}
	getMarkerTop(e) {
		return e ? this.getAxisOffset(e.row || 0, this.getAllRowHeights(), this.defaults.rowHeight) + R_(e.rowOff) : 0;
	}
	getImages() {
		let e = this.ws["!drawings"], t = (e == null ? void 0 : e.images) || [];
		if (!t.length) return;
		let n = t.flatMap((e, t) => {
			var n, r, i, a, o;
			let s = e.anchor;
			if (!e.dataURI || !s) return [];
			let c = s.from, l = c ? this.getMarkerLeft(c) : R_((n = s.pos) == null ? void 0 : n.x), u = c ? this.getMarkerTop(c) : R_((r = s.pos) == null ? void 0 : r.y), d = s.to ? this.getMarkerLeft(s.to) : l + R_((i = s.ext) == null ? void 0 : i.cx), f = s.to ? this.getMarkerTop(s.to) : u + R_((a = s.ext) == null ? void 0 : a.cy);
			return [{
				id: e.id || ((o = e.objectId) == null ? void 0 : o.toString()) || e.target || `image-${t + 1}`,
				src: e.dataURI,
				contentType: e.contentType,
				left: Math.max(0, l),
				top: Math.max(0, u),
				width: Math.max(1, d > l ? d - l : O_),
				height: Math.max(1, f > u ? f - u : k_),
				row: (c == null ? void 0 : c.row) || 0,
				col: (c == null ? void 0 : c.col) || 0
			}];
		});
		return n.length ? n : void 0;
	}
	getAllMerge() {
		let { "!merges": e = [] } = this.ws;
		return e.map((e) => {
			let { r: t, c: n } = e.s, { r, c: i } = e.e;
			return {
				row: t,
				col: n,
				rowspan: r - t + 1,
				colspan: i - n + 1
			};
		});
	}
	getData() {
		let e = [], t = this.denseRows;
		for (let n = this.startRow; n < this.endRow; n += 1) {
			let r = t == null ? void 0 : t[n], i = r ? r.slice(0, this.totalCols).map((e) => F_(e)) : Array.from({ length: this.totalCols }, (e, t) => F_(this.getCellAt(n, t)));
			e.push(i);
		}
		return Z_(e, this.totalCols);
	}
	getCell() {
		let e = {}, { "!cols": t = [], "!rows": n = [] } = this.ws;
		for (let a = this.startRow; a < this.endRow; a += 1) for (let o = 0; o < this.totalCols; o += 1) {
			var r, i;
			let s = this.getCellAt(a, o), c = Y_((r = t[o]) == null ? void 0 : r.s, (i = n[a]) == null ? void 0 : i.s, s == null ? void 0 : s.s), l = U_(c == null ? void 0 : c.alignment), u = X_(c);
			!l && !u || (e[P_(a - this.startRow, o)] = {
				...l ? { className: l } : {},
				style: u || {}
			});
		}
		return e;
	}
	getMerge() {
		return this.getAllMerge().flatMap((e) => e.row + e.rowspan - 1 < this.startRow || e.row >= this.endRow || e.row < this.startRow ? [] : {
			...e,
			row: e.row - this.startRow
		});
	}
	getRowHeights() {
		let { rowHeight: e } = this.defaults, { "!rows": t = [] } = this.ws, n = [];
		if (t.length && this.endRow > this.startRow) for (let e = this.startRow; e < this.endRow; e += 1) {
			let r = B_(t[e]);
			r !== void 0 && (n[e - this.startRow] = r);
		}
		return n.length === 1 ? n[0] : n.length ? n : e;
	}
	getAllRowHeights() {
		let { "!rows": e = [] } = this.ws, t = [];
		if (e.length) for (let n = 0; n < this.totalRows; n += 1) {
			let r = B_(e[n]);
			r !== void 0 && (t[n] = r);
		}
		return t.length ? t : void 0;
	}
	getAutoFitColumns() {
		let e = Dg.auto_fit_columns || Dg.autofit_columns;
		if (typeof e == "function") try {
			return e(this.ws, {
				set: !1,
				skipHidden: !0,
				includeMerged: !1,
				minPx: A_,
				padding: j_
			});
		} catch (e) {
			console.warn("[file-viewer] Excel 自动列宽计算失败，已回退到原始列宽。", e);
			return;
		}
	}
	get autoFitColumns() {
		return this._autoFitColumns === void 0 && (this._autoFitColumns = this.getAutoFitColumns() || null), this._autoFitColumns || void 0;
	}
	getColumnMeta(e, t) {
		var n;
		let r = e[t];
		return z_(r) ? r : ((n = this.autoFitColumns) == null ? void 0 : n[t]) || r;
	}
	getColWidths() {
		let { colWidth: e } = this.defaults, { "!cols": t = [] } = this.ws, n = [];
		for (let e = 0; e < this.totalCols; e += 1) {
			let r = I_(this.getColumnMeta(t, e));
			r !== void 0 && (n[e] = r);
		}
		return n.length ? n : e;
	}
	getColumns() {
		let { "!cols": e = [] } = this.ws;
		return Array.from({ length: this.totalCols }, (t, n) => {
			var r;
			let i = this.getColumnMeta(e, n);
			return {
				key: n + 1,
				title: Dg.encode_col(n),
				hidden: !!(i != null && i.hidden),
				editor: !1,
				className: U_(i == null || (r = i.s) == null ? void 0 : r.alignment),
				renderer: "styleRender"
			};
		});
	}
	getStructure() {
		return {
			merge: this.getAllMerge(),
			colWidths: this.getColWidths(),
			rowHeights: this.getAllRowHeights(),
			columns: this.getColumns(),
			images: this.getImages()
		};
	}
	toObject() {
		let { defaults: e, data: t, cell: n, merge: r, rowHeights: i, colWidths: a, columns: o, meta: s } = this;
		return {
			defaults: e,
			data: t,
			cell: n,
			merge: r,
			rowHeights: i,
			colWidths: a,
			columns: o,
			meta: s
		};
	}
};
C_ = Q_, C_.defaults = N_;
//#endregion
//#region packages/core/src/renderers/spreadsheet/worker/sheetjs/parser.ts
var $_ = {
	type: "array",
	dense: !0,
	cellDates: !0,
	cellStyles: !0,
	browserPixels: !0,
	drawings: !0,
	validateMerges: !0
}, ev = () => ({
	workbook: null,
	sheets: []
}), tv = (e, t = {}) => ({
	type: "parseError",
	payload: {
		...t,
		message: e instanceof Error ? e.message : String(e)
	}
}), nv = (e) => {
	var t;
	let n = e.workbook;
	if (!(n != null && n.SheetNames)) return [];
	let r = ((t = n.Workbook) == null ? void 0 : t.Sheets) || [];
	return e.sheets = n.SheetNames.reduce((e, t, i) => {
		var a;
		let o = n.Sheets[t], s = o == null ? void 0 : o["!ref"];
		if (!s) return e;
		let c = Dg.decode_range(s);
		return e.push({
			id: e.length,
			name: t,
			hidden: !!((a = r[i]) != null && a.Hidden),
			rowCount: c.e.r + 1,
			colCount: c.e.c + 1
		}), e;
	}, []), [{
		type: "sheets",
		payload: { sheets: e.sheets }
	}];
}, rv = (e, t) => {
	try {
		return e.workbook = sg(t, $_), nv(e);
	} catch (e) {
		return [tv(e)];
	}
}, iv = (e, t = {}) => {
	let { sheet: n, startRow: r = 0, pageSize: i = 500, sessionId: a = 0 } = t;
	try {
		var o;
		let t = e.workbook, s = (o = e.sheets.find((e) => e.id === n)) == null ? void 0 : o.name;
		if (!(t != null && t.Sheets) || !s) return [];
		let c = t.Sheets[s];
		if (!c) return [];
		let l = e.sheets.find((e) => e.id === n), u = Q_.create(c, {
			startRow: r,
			pageSize: i,
			totalRows: l == null ? void 0 : l.rowCount,
			totalCols: l == null ? void 0 : l.colCount
		}), d = u.toObject(), f = r === 0 ? u.structure : void 0;
		return [{
			type: "parseSheet",
			payload: {
				sessionId: a,
				sheet: n,
				sheetData: f ? {
					...d,
					structure: f
				} : d
			}
		}];
	} catch (e) {
		return [tv(e, {
			sessionId: a,
			startRow: r
		})];
	}
}, av = (e, t) => {
	switch (t.type) {
		case "parseWorkbook":
			var n;
			return rv(e, (n = t.payload) == null ? void 0 : n.workbook);
		case "parseSheet": return iv(e, t.payload);
		default: return [];
	}
}, ov = self, sv = ev();
ov.onmessage = async (e) => {
	av(sv, e.data).forEach((e) => {
		ov.postMessage(e);
	});
}, ov.onerror = (e) => {
	console.error(e);
};
//#endregion
