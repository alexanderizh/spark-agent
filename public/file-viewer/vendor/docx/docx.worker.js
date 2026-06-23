//#region \0rolldown/runtime.js
var e = Object.create, t = Object.defineProperty, n = Object.getOwnPropertyDescriptor, r = Object.getOwnPropertyNames, i = Object.getPrototypeOf, a = Object.prototype.hasOwnProperty, o = (e, t) => () => (e && (t = e(e = 0)), t), s = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), c = (e, n) => {
	let r = {};
	for (var i in e) t(r, i, {
		get: e[i],
		enumerable: !0
	});
	return n || t(r, Symbol.toStringTag, { value: "Module" }), r;
}, l = (e, i, o, s) => {
	if (i && typeof i == "object" || typeof i == "function") for (var c = r(i), l = 0, u = c.length, d; l < u; l++) d = c[l], !a.call(e, d) && d !== o && t(e, d, {
		get: ((e) => i[e]).bind(null, d),
		enumerable: !(s = n(i, d)) || s.enumerable
	});
	return e;
}, u = (n, r, a) => (a = n == null ? {} : e(i(n)), l(r || !n || !n.__esModule ? t(a, "default", {
	value: n,
	enumerable: !0
}) : a, n)), d = (e) => a.call(e, "module.exports") ? e["module.exports"] : l(t({}, "__esModule", { value: !0 }), e), f = /* @__PURE__ */ ((e) => typeof require < "u" ? require : typeof Proxy < "u" ? new Proxy(e, { get: (e, t) => (typeof require < "u" ? require : e)[t] }) : e)(function(e) {
	if (typeof require < "u") return require.apply(this, arguments);
	throw Error("Calling `require` for \"" + e + "\" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.");
}), p = /* @__PURE__ */ u((/* @__PURE__ */ s(((e, t) => {
	(function(n) {
		typeof e == "object" && t !== void 0 ? t.exports = n() : typeof define == "function" && define.amd ? define([], n) : (typeof window < "u" ? window : typeof global < "u" ? global : typeof self < "u" ? self : this).JSZip = n();
	})(function() {
		return function e(t, n, r) {
			function i(o, s) {
				if (!n[o]) {
					if (!t[o]) {
						var c = typeof f == "function" && f;
						if (!s && c) return c(o, !0);
						if (a) return a(o, !0);
						var l = /* @__PURE__ */ Error("Cannot find module '" + o + "'");
						throw l.code = "MODULE_NOT_FOUND", l;
					}
					var u = n[o] = { exports: {} };
					t[o][0].call(u.exports, function(e) {
						var n = t[o][1][e];
						return i(n || e);
					}, u, u.exports, e, t, n, r);
				}
				return n[o].exports;
			}
			for (var a = typeof f == "function" && f, o = 0; o < r.length; o++) i(r[o]);
			return i;
		}({
			1: [function(e, t, n) {
				var r = e("./utils"), i = e("./support"), a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
				n.encode = function(e) {
					for (var t, n, i, o, s, c, l, u = [], d = 0, f = e.length, p = f, m = r.getTypeOf(e) !== "string"; d < e.length;) p = f - d, i = m ? (t = e[d++], n = d < f ? e[d++] : 0, d < f ? e[d++] : 0) : (t = e.charCodeAt(d++), n = d < f ? e.charCodeAt(d++) : 0, d < f ? e.charCodeAt(d++) : 0), o = t >> 2, s = (3 & t) << 4 | n >> 4, c = 1 < p ? (15 & n) << 2 | i >> 6 : 64, l = 2 < p ? 63 & i : 64, u.push(a.charAt(o) + a.charAt(s) + a.charAt(c) + a.charAt(l));
					return u.join("");
				}, n.decode = function(e) {
					var t, n, r, o, s, c, l = 0, u = 0, d = "data:";
					if (e.substr(0, d.length) === d) throw Error("Invalid base64 input, it looks like a data url.");
					var f, p = 3 * (e = e.replace(/[^A-Za-z0-9+/=]/g, "")).length / 4;
					if (e.charAt(e.length - 1) === a.charAt(64) && p--, e.charAt(e.length - 2) === a.charAt(64) && p--, p % 1 != 0) throw Error("Invalid base64 input, bad content length.");
					for (f = i.uint8array ? new Uint8Array(0 | p) : Array(0 | p); l < e.length;) t = a.indexOf(e.charAt(l++)) << 2 | (o = a.indexOf(e.charAt(l++))) >> 4, n = (15 & o) << 4 | (s = a.indexOf(e.charAt(l++))) >> 2, r = (3 & s) << 6 | (c = a.indexOf(e.charAt(l++))), f[u++] = t, s !== 64 && (f[u++] = n), c !== 64 && (f[u++] = r);
					return f;
				};
			}, {
				"./support": 30,
				"./utils": 32
			}],
			2: [function(e, t, n) {
				var r = e("./external"), i = e("./stream/DataWorker"), a = e("./stream/Crc32Probe"), o = e("./stream/DataLengthProbe");
				function s(e, t, n, r, i) {
					this.compressedSize = e, this.uncompressedSize = t, this.crc32 = n, this.compression = r, this.compressedContent = i;
				}
				s.prototype = {
					getContentWorker: function() {
						var e = new i(r.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new o("data_length")), t = this;
						return e.on("end", function() {
							if (this.streamInfo.data_length !== t.uncompressedSize) throw Error("Bug : uncompressed data size mismatch");
						}), e;
					},
					getCompressedWorker: function() {
						return new i(r.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
					}
				}, s.createWorkerFrom = function(e, t, n) {
					return e.pipe(new a()).pipe(new o("uncompressedSize")).pipe(t.compressWorker(n)).pipe(new o("compressedSize")).withStreamInfo("compression", t);
				}, t.exports = s;
			}, {
				"./external": 6,
				"./stream/Crc32Probe": 25,
				"./stream/DataLengthProbe": 26,
				"./stream/DataWorker": 27
			}],
			3: [function(e, t, n) {
				var r = e("./stream/GenericWorker");
				n.STORE = {
					magic: "\0\0",
					compressWorker: function() {
						return new r("STORE compression");
					},
					uncompressWorker: function() {
						return new r("STORE decompression");
					}
				}, n.DEFLATE = e("./flate");
			}, {
				"./flate": 7,
				"./stream/GenericWorker": 28
			}],
			4: [function(e, t, n) {
				var r = e("./utils"), i = function() {
					for (var e, t = [], n = 0; n < 256; n++) {
						e = n;
						for (var r = 0; r < 8; r++) e = 1 & e ? 3988292384 ^ e >>> 1 : e >>> 1;
						t[n] = e;
					}
					return t;
				}();
				t.exports = function(e, t) {
					return e !== void 0 && e.length ? r.getTypeOf(e) === "string" ? function(e, t, n, r) {
						var a = i, o = r + n;
						e ^= -1;
						for (var s = r; s < o; s++) e = e >>> 8 ^ a[255 & (e ^ t.charCodeAt(s))];
						return -1 ^ e;
					}(0 | t, e, e.length, 0) : function(e, t, n, r) {
						var a = i, o = r + n;
						e ^= -1;
						for (var s = r; s < o; s++) e = e >>> 8 ^ a[255 & (e ^ t[s])];
						return -1 ^ e;
					}(0 | t, e, e.length, 0) : 0;
				};
			}, { "./utils": 32 }],
			5: [function(e, t, n) {
				n.base64 = !1, n.binary = !1, n.dir = !1, n.createFolders = !0, n.date = null, n.compression = null, n.compressionOptions = null, n.comment = null, n.unixPermissions = null, n.dosPermissions = null;
			}, {}],
			6: [function(e, t, n) {
				var r = null;
				r = typeof Promise < "u" ? Promise : e("lie"), t.exports = { Promise: r };
			}, { lie: 37 }],
			7: [function(e, t, n) {
				var r = typeof Uint8Array < "u" && typeof Uint16Array < "u" && typeof Uint32Array < "u", i = e("pako"), a = e("./utils"), o = e("./stream/GenericWorker"), s = r ? "uint8array" : "array";
				function c(e, t) {
					o.call(this, "FlateWorker/" + e), this._pako = null, this._pakoAction = e, this._pakoOptions = t, this.meta = {};
				}
				n.magic = "\b\0", a.inherits(c, o), c.prototype.processChunk = function(e) {
					this.meta = e.meta, this._pako === null && this._createPako(), this._pako.push(a.transformTo(s, e.data), !1);
				}, c.prototype.flush = function() {
					o.prototype.flush.call(this), this._pako === null && this._createPako(), this._pako.push([], !0);
				}, c.prototype.cleanUp = function() {
					o.prototype.cleanUp.call(this), this._pako = null;
				}, c.prototype._createPako = function() {
					this._pako = new i[this._pakoAction]({
						raw: !0,
						level: this._pakoOptions.level || -1
					});
					var e = this;
					this._pako.onData = function(t) {
						e.push({
							data: t,
							meta: e.meta
						});
					};
				}, n.compressWorker = function(e) {
					return new c("Deflate", e);
				}, n.uncompressWorker = function() {
					return new c("Inflate", {});
				};
			}, {
				"./stream/GenericWorker": 28,
				"./utils": 32,
				pako: 38
			}],
			8: [function(e, t, n) {
				function r(e, t) {
					var n, r = "";
					for (n = 0; n < t; n++) r += String.fromCharCode(255 & e), e >>>= 8;
					return r;
				}
				function i(e, t, n, i, o, u) {
					var d, f, p = e.file, m = e.compression, h = u !== s.utf8encode, g = a.transformTo("string", u(p.name)), _ = a.transformTo("string", s.utf8encode(p.name)), v = p.comment, y = a.transformTo("string", u(v)), b = a.transformTo("string", s.utf8encode(v)), x = _.length !== p.name.length, S = b.length !== v.length, C = "", w = "", T = "", E = p.dir, D = p.date, O = {
						crc32: 0,
						compressedSize: 0,
						uncompressedSize: 0
					};
					t && !n || (O.crc32 = e.crc32, O.compressedSize = e.compressedSize, O.uncompressedSize = e.uncompressedSize);
					var k = 0;
					t && (k |= 8), h || !x && !S || (k |= 2048);
					var A = 0, j = 0;
					E && (A |= 16), o === "UNIX" ? (j = 798, A |= function(e, t) {
						var n = e;
						return e || (n = t ? 16893 : 33204), (65535 & n) << 16;
					}(p.unixPermissions, E)) : (j = 20, A |= function(e) {
						return 63 & (e || 0);
					}(p.dosPermissions)), d = D.getUTCHours(), d <<= 6, d |= D.getUTCMinutes(), d <<= 5, d |= D.getUTCSeconds() / 2, f = D.getUTCFullYear() - 1980, f <<= 4, f |= D.getUTCMonth() + 1, f <<= 5, f |= D.getUTCDate(), x && (w = r(1, 1) + r(c(g), 4) + _, C += "up" + r(w.length, 2) + w), S && (T = r(1, 1) + r(c(y), 4) + b, C += "uc" + r(T.length, 2) + T);
					var M = "";
					return M += "\n\0", M += r(k, 2), M += m.magic, M += r(d, 2), M += r(f, 2), M += r(O.crc32, 4), M += r(O.compressedSize, 4), M += r(O.uncompressedSize, 4), M += r(g.length, 2), M += r(C.length, 2), {
						fileRecord: l.LOCAL_FILE_HEADER + M + g + C,
						dirRecord: l.CENTRAL_FILE_HEADER + r(j, 2) + M + r(y.length, 2) + "\0\0\0\0" + r(A, 4) + r(i, 4) + g + C + y
					};
				}
				var a = e("../utils"), o = e("../stream/GenericWorker"), s = e("../utf8"), c = e("../crc32"), l = e("../signature");
				function u(e, t, n, r) {
					o.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = t, this.zipPlatform = n, this.encodeFileName = r, this.streamFiles = e, this.accumulate = !1, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
				}
				a.inherits(u, o), u.prototype.push = function(e) {
					var t = e.meta.percent || 0, n = this.entriesCount, r = this._sources.length;
					this.accumulate ? this.contentBuffer.push(e) : (this.bytesWritten += e.data.length, o.prototype.push.call(this, {
						data: e.data,
						meta: {
							currentFile: this.currentFile,
							percent: n ? (t + 100 * (n - r - 1)) / n : 100
						}
					}));
				}, u.prototype.openedSource = function(e) {
					this.currentSourceOffset = this.bytesWritten, this.currentFile = e.file.name;
					var t = this.streamFiles && !e.file.dir;
					if (t) {
						var n = i(e, t, !1, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
						this.push({
							data: n.fileRecord,
							meta: { percent: 0 }
						});
					} else this.accumulate = !0;
				}, u.prototype.closedSource = function(e) {
					this.accumulate = !1;
					var t = this.streamFiles && !e.file.dir, n = i(e, t, !0, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
					if (this.dirRecords.push(n.dirRecord), t) this.push({
						data: function(e) {
							return l.DATA_DESCRIPTOR + r(e.crc32, 4) + r(e.compressedSize, 4) + r(e.uncompressedSize, 4);
						}(e),
						meta: { percent: 100 }
					});
					else for (this.push({
						data: n.fileRecord,
						meta: { percent: 0 }
					}); this.contentBuffer.length;) this.push(this.contentBuffer.shift());
					this.currentFile = null;
				}, u.prototype.flush = function() {
					for (var e = this.bytesWritten, t = 0; t < this.dirRecords.length; t++) this.push({
						data: this.dirRecords[t],
						meta: { percent: 100 }
					});
					var n = this.bytesWritten - e, i = function(e, t, n, i, o) {
						var s = a.transformTo("string", o(i));
						return l.CENTRAL_DIRECTORY_END + "\0\0\0\0" + r(e, 2) + r(e, 2) + r(t, 4) + r(n, 4) + r(s.length, 2) + s;
					}(this.dirRecords.length, n, e, this.zipComment, this.encodeFileName);
					this.push({
						data: i,
						meta: { percent: 100 }
					});
				}, u.prototype.prepareNextSource = function() {
					this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
				}, u.prototype.registerPrevious = function(e) {
					this._sources.push(e);
					var t = this;
					return e.on("data", function(e) {
						t.processChunk(e);
					}), e.on("end", function() {
						t.closedSource(t.previous.streamInfo), t._sources.length ? t.prepareNextSource() : t.end();
					}), e.on("error", function(e) {
						t.error(e);
					}), this;
				}, u.prototype.resume = function() {
					return !!o.prototype.resume.call(this) && (!this.previous && this._sources.length ? (this.prepareNextSource(), !0) : this.previous || this._sources.length || this.generatedError ? void 0 : (this.end(), !0));
				}, u.prototype.error = function(e) {
					var t = this._sources;
					if (!o.prototype.error.call(this, e)) return !1;
					for (var n = 0; n < t.length; n++) try {
						t[n].error(e);
					} catch {}
					return !0;
				}, u.prototype.lock = function() {
					o.prototype.lock.call(this);
					for (var e = this._sources, t = 0; t < e.length; t++) e[t].lock();
				}, t.exports = u;
			}, {
				"../crc32": 4,
				"../signature": 23,
				"../stream/GenericWorker": 28,
				"../utf8": 31,
				"../utils": 32
			}],
			9: [function(e, t, n) {
				var r = e("../compressions"), i = e("./ZipFileWorker");
				n.generateWorker = function(e, t, n) {
					var a = new i(t.streamFiles, n, t.platform, t.encodeFileName), o = 0;
					try {
						e.forEach(function(e, n) {
							o++;
							var i = function(e, t) {
								var n = e || t, i = r[n];
								if (!i) throw Error(n + " is not a valid compression method !");
								return i;
							}(n.options.compression, t.compression), s = n.options.compressionOptions || t.compressionOptions || {}, c = n.dir, l = n.date;
							n._compressWorker(i, s).withStreamInfo("file", {
								name: e,
								dir: c,
								date: l,
								comment: n.comment || "",
								unixPermissions: n.unixPermissions,
								dosPermissions: n.dosPermissions
							}).pipe(a);
						}), a.entriesCount = o;
					} catch (e) {
						a.error(e);
					}
					return a;
				};
			}, {
				"../compressions": 3,
				"./ZipFileWorker": 8
			}],
			10: [function(e, t, n) {
				function r() {
					if (!(this instanceof r)) return new r();
					if (arguments.length) throw Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
					this.files = Object.create(null), this.comment = null, this.root = "", this.clone = function() {
						var e = new r();
						for (var t in this) typeof this[t] != "function" && (e[t] = this[t]);
						return e;
					};
				}
				(r.prototype = e("./object")).loadAsync = e("./load"), r.support = e("./support"), r.defaults = e("./defaults"), r.version = "3.10.1", r.loadAsync = function(e, t) {
					return new r().loadAsync(e, t);
				}, r.external = e("./external"), t.exports = r;
			}, {
				"./defaults": 5,
				"./external": 6,
				"./load": 11,
				"./object": 15,
				"./support": 30
			}],
			11: [function(e, t, n) {
				var r = e("./utils"), i = e("./external"), a = e("./utf8"), o = e("./zipEntries"), s = e("./stream/Crc32Probe"), c = e("./nodejsUtils");
				function l(e) {
					return new i.Promise(function(t, n) {
						var r = e.decompressed.getContentWorker().pipe(new s());
						r.on("error", function(e) {
							n(e);
						}).on("end", function() {
							r.streamInfo.crc32 === e.decompressed.crc32 ? t() : n(/* @__PURE__ */ Error("Corrupted zip : CRC32 mismatch"));
						}).resume();
					});
				}
				t.exports = function(e, t) {
					var n = this;
					return t = r.extend(t || {}, {
						base64: !1,
						checkCRC32: !1,
						optimizedBinaryString: !1,
						createFolders: !1,
						decodeFileName: a.utf8decode
					}), c.isNode && c.isStream(e) ? i.Promise.reject(/* @__PURE__ */ Error("JSZip can't accept a stream when loading a zip file.")) : r.prepareContent("the loaded zip file", e, !0, t.optimizedBinaryString, t.base64).then(function(e) {
						var n = new o(t);
						return n.load(e), n;
					}).then(function(e) {
						var n = [i.Promise.resolve(e)], r = e.files;
						if (t.checkCRC32) for (var a = 0; a < r.length; a++) n.push(l(r[a]));
						return i.Promise.all(n);
					}).then(function(e) {
						for (var i = e.shift(), a = i.files, o = 0; o < a.length; o++) {
							var s = a[o], c = s.fileNameStr, l = r.resolve(s.fileNameStr);
							n.file(l, s.decompressed, {
								binary: !0,
								optimizedBinaryString: !0,
								date: s.date,
								dir: s.dir,
								comment: s.fileCommentStr.length ? s.fileCommentStr : null,
								unixPermissions: s.unixPermissions,
								dosPermissions: s.dosPermissions,
								createFolders: t.createFolders
							}), s.dir || (n.file(l).unsafeOriginalName = c);
						}
						return i.zipComment.length && (n.comment = i.zipComment), n;
					});
				};
			}, {
				"./external": 6,
				"./nodejsUtils": 14,
				"./stream/Crc32Probe": 25,
				"./utf8": 31,
				"./utils": 32,
				"./zipEntries": 33
			}],
			12: [function(e, t, n) {
				var r = e("../utils"), i = e("../stream/GenericWorker");
				function a(e, t) {
					i.call(this, "Nodejs stream input adapter for " + e), this._upstreamEnded = !1, this._bindStream(t);
				}
				r.inherits(a, i), a.prototype._bindStream = function(e) {
					var t = this;
					(this._stream = e).pause(), e.on("data", function(e) {
						t.push({
							data: e,
							meta: { percent: 0 }
						});
					}).on("error", function(e) {
						t.isPaused ? this.generatedError = e : t.error(e);
					}).on("end", function() {
						t.isPaused ? t._upstreamEnded = !0 : t.end();
					});
				}, a.prototype.pause = function() {
					return !!i.prototype.pause.call(this) && (this._stream.pause(), !0);
				}, a.prototype.resume = function() {
					return !!i.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), !0);
				}, t.exports = a;
			}, {
				"../stream/GenericWorker": 28,
				"../utils": 32
			}],
			13: [function(e, t, n) {
				var r = e("readable-stream").Readable;
				function i(e, t, n) {
					r.call(this, t), this._helper = e;
					var i = this;
					e.on("data", function(e, t) {
						i.push(e) || i._helper.pause(), n && n(t);
					}).on("error", function(e) {
						i.emit("error", e);
					}).on("end", function() {
						i.push(null);
					});
				}
				e("../utils").inherits(i, r), i.prototype._read = function() {
					this._helper.resume();
				}, t.exports = i;
			}, {
				"../utils": 32,
				"readable-stream": 16
			}],
			14: [function(e, t, n) {
				t.exports = {
					isNode: typeof Buffer < "u",
					newBufferFrom: function(e, t) {
						if (Buffer.from && Buffer.from !== Uint8Array.from) return Buffer.from(e, t);
						if (typeof e == "number") throw Error("The \"data\" argument must not be a number");
						return new Buffer(e, t);
					},
					allocBuffer: function(e) {
						if (Buffer.alloc) return Buffer.alloc(e);
						var t = new Buffer(e);
						return t.fill(0), t;
					},
					isBuffer: function(e) {
						return Buffer.isBuffer(e);
					},
					isStream: function(e) {
						return e && typeof e.on == "function" && typeof e.pause == "function" && typeof e.resume == "function";
					}
				};
			}, {}],
			15: [function(e, t, n) {
				function r(e, t, n) {
					var r, i = a.getTypeOf(t), s = a.extend(n || {}, c);
					s.date = s.date || /* @__PURE__ */ new Date(), s.compression !== null && (s.compression = s.compression.toUpperCase()), typeof s.unixPermissions == "string" && (s.unixPermissions = parseInt(s.unixPermissions, 8)), s.unixPermissions && 16384 & s.unixPermissions && (s.dir = !0), s.dosPermissions && 16 & s.dosPermissions && (s.dir = !0), s.dir && (e = h(e)), s.createFolders && (r = m(e)) && g.call(this, r, !0);
					var d = i === "string" && !1 === s.binary && !1 === s.base64;
					n && n.binary !== void 0 || (s.binary = !d), (t instanceof l && t.uncompressedSize === 0 || s.dir || !t || t.length === 0) && (s.base64 = !1, s.binary = !0, t = "", s.compression = "STORE", i = "string");
					var _ = null;
					_ = t instanceof l || t instanceof o ? t : f.isNode && f.isStream(t) ? new p(e, t) : a.prepareContent(e, t, s.binary, s.optimizedBinaryString, s.base64);
					var v = new u(e, _, s);
					this.files[e] = v;
				}
				var i = e("./utf8"), a = e("./utils"), o = e("./stream/GenericWorker"), s = e("./stream/StreamHelper"), c = e("./defaults"), l = e("./compressedObject"), u = e("./zipObject"), d = e("./generate"), f = e("./nodejsUtils"), p = e("./nodejs/NodejsStreamInputAdapter"), m = function(e) {
					e.slice(-1) === "/" && (e = e.substring(0, e.length - 1));
					var t = e.lastIndexOf("/");
					return 0 < t ? e.substring(0, t) : "";
				}, h = function(e) {
					return e.slice(-1) !== "/" && (e += "/"), e;
				}, g = function(e, t) {
					return t = t === void 0 ? c.createFolders : t, e = h(e), this.files[e] || r.call(this, e, null, {
						dir: !0,
						createFolders: t
					}), this.files[e];
				};
				function _(e) {
					return Object.prototype.toString.call(e) === "[object RegExp]";
				}
				t.exports = {
					load: function() {
						throw Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
					},
					forEach: function(e) {
						var t, n, r;
						for (t in this.files) r = this.files[t], (n = t.slice(this.root.length, t.length)) && t.slice(0, this.root.length) === this.root && e(n, r);
					},
					filter: function(e) {
						var t = [];
						return this.forEach(function(n, r) {
							e(n, r) && t.push(r);
						}), t;
					},
					file: function(e, t, n) {
						if (arguments.length !== 1) return e = this.root + e, r.call(this, e, t, n), this;
						if (_(e)) {
							var i = e;
							return this.filter(function(e, t) {
								return !t.dir && i.test(e);
							});
						}
						var a = this.files[this.root + e];
						return a && !a.dir ? a : null;
					},
					folder: function(e) {
						if (!e) return this;
						if (_(e)) return this.filter(function(t, n) {
							return n.dir && e.test(t);
						});
						var t = this.root + e, n = g.call(this, t), r = this.clone();
						return r.root = n.name, r;
					},
					remove: function(e) {
						e = this.root + e;
						var t = this.files[e];
						if (t || (e.slice(-1) !== "/" && (e += "/"), t = this.files[e]), t && !t.dir) delete this.files[e];
						else for (var n = this.filter(function(t, n) {
							return n.name.slice(0, e.length) === e;
						}), r = 0; r < n.length; r++) delete this.files[n[r].name];
						return this;
					},
					generate: function() {
						throw Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
					},
					generateInternalStream: function(e) {
						var t, n = {};
						try {
							if ((n = a.extend(e || {}, {
								streamFiles: !1,
								compression: "STORE",
								compressionOptions: null,
								type: "",
								platform: "DOS",
								comment: null,
								mimeType: "application/zip",
								encodeFileName: i.utf8encode
							})).type = n.type.toLowerCase(), n.compression = n.compression.toUpperCase(), n.type === "binarystring" && (n.type = "string"), !n.type) throw Error("No output type specified.");
							a.checkSupport(n.type), n.platform !== "darwin" && n.platform !== "freebsd" && n.platform !== "linux" && n.platform !== "sunos" || (n.platform = "UNIX"), n.platform === "win32" && (n.platform = "DOS");
							var r = n.comment || this.comment || "";
							t = d.generateWorker(this, n, r);
						} catch (e) {
							(t = new o("error")).error(e);
						}
						return new s(t, n.type || "string", n.mimeType);
					},
					generateAsync: function(e, t) {
						return this.generateInternalStream(e).accumulate(t);
					},
					generateNodeStream: function(e, t) {
						return (e = e || {}).type || (e.type = "nodebuffer"), this.generateInternalStream(e).toNodejsStream(t);
					}
				};
			}, {
				"./compressedObject": 2,
				"./defaults": 5,
				"./generate": 9,
				"./nodejs/NodejsStreamInputAdapter": 12,
				"./nodejsUtils": 14,
				"./stream/GenericWorker": 28,
				"./stream/StreamHelper": 29,
				"./utf8": 31,
				"./utils": 32,
				"./zipObject": 35
			}],
			16: [function(e, t, n) {
				t.exports = e("stream");
			}, { stream: void 0 }],
			17: [function(e, t, n) {
				var r = e("./DataReader");
				function i(e) {
					r.call(this, e);
					for (var t = 0; t < this.data.length; t++) e[t] = 255 & e[t];
				}
				e("../utils").inherits(i, r), i.prototype.byteAt = function(e) {
					return this.data[this.zero + e];
				}, i.prototype.lastIndexOfSignature = function(e) {
					for (var t = e.charCodeAt(0), n = e.charCodeAt(1), r = e.charCodeAt(2), i = e.charCodeAt(3), a = this.length - 4; 0 <= a; --a) if (this.data[a] === t && this.data[a + 1] === n && this.data[a + 2] === r && this.data[a + 3] === i) return a - this.zero;
					return -1;
				}, i.prototype.readAndCheckSignature = function(e) {
					var t = e.charCodeAt(0), n = e.charCodeAt(1), r = e.charCodeAt(2), i = e.charCodeAt(3), a = this.readData(4);
					return t === a[0] && n === a[1] && r === a[2] && i === a[3];
				}, i.prototype.readData = function(e) {
					if (this.checkOffset(e), e === 0) return [];
					var t = this.data.slice(this.zero + this.index, this.zero + this.index + e);
					return this.index += e, t;
				}, t.exports = i;
			}, {
				"../utils": 32,
				"./DataReader": 18
			}],
			18: [function(e, t, n) {
				var r = e("../utils");
				function i(e) {
					this.data = e, this.length = e.length, this.index = 0, this.zero = 0;
				}
				i.prototype = {
					checkOffset: function(e) {
						this.checkIndex(this.index + e);
					},
					checkIndex: function(e) {
						if (this.length < this.zero + e || e < 0) throw Error("End of data reached (data length = " + this.length + ", asked index = " + e + "). Corrupted zip ?");
					},
					setIndex: function(e) {
						this.checkIndex(e), this.index = e;
					},
					skip: function(e) {
						this.setIndex(this.index + e);
					},
					byteAt: function() {},
					readInt: function(e) {
						var t, n = 0;
						for (this.checkOffset(e), t = this.index + e - 1; t >= this.index; t--) n = (n << 8) + this.byteAt(t);
						return this.index += e, n;
					},
					readString: function(e) {
						return r.transformTo("string", this.readData(e));
					},
					readData: function() {},
					lastIndexOfSignature: function() {},
					readAndCheckSignature: function() {},
					readDate: function() {
						var e = this.readInt(4);
						return new Date(Date.UTC(1980 + (e >> 25 & 127), (e >> 21 & 15) - 1, e >> 16 & 31, e >> 11 & 31, e >> 5 & 63, (31 & e) << 1));
					}
				}, t.exports = i;
			}, { "../utils": 32 }],
			19: [function(e, t, n) {
				var r = e("./Uint8ArrayReader");
				function i(e) {
					r.call(this, e);
				}
				e("../utils").inherits(i, r), i.prototype.readData = function(e) {
					this.checkOffset(e);
					var t = this.data.slice(this.zero + this.index, this.zero + this.index + e);
					return this.index += e, t;
				}, t.exports = i;
			}, {
				"../utils": 32,
				"./Uint8ArrayReader": 21
			}],
			20: [function(e, t, n) {
				var r = e("./DataReader");
				function i(e) {
					r.call(this, e);
				}
				e("../utils").inherits(i, r), i.prototype.byteAt = function(e) {
					return this.data.charCodeAt(this.zero + e);
				}, i.prototype.lastIndexOfSignature = function(e) {
					return this.data.lastIndexOf(e) - this.zero;
				}, i.prototype.readAndCheckSignature = function(e) {
					return e === this.readData(4);
				}, i.prototype.readData = function(e) {
					this.checkOffset(e);
					var t = this.data.slice(this.zero + this.index, this.zero + this.index + e);
					return this.index += e, t;
				}, t.exports = i;
			}, {
				"../utils": 32,
				"./DataReader": 18
			}],
			21: [function(e, t, n) {
				var r = e("./ArrayReader");
				function i(e) {
					r.call(this, e);
				}
				e("../utils").inherits(i, r), i.prototype.readData = function(e) {
					if (this.checkOffset(e), e === 0) return new Uint8Array();
					var t = this.data.subarray(this.zero + this.index, this.zero + this.index + e);
					return this.index += e, t;
				}, t.exports = i;
			}, {
				"../utils": 32,
				"./ArrayReader": 17
			}],
			22: [function(e, t, n) {
				var r = e("../utils"), i = e("../support"), a = e("./ArrayReader"), o = e("./StringReader"), s = e("./NodeBufferReader"), c = e("./Uint8ArrayReader");
				t.exports = function(e) {
					var t = r.getTypeOf(e);
					return r.checkSupport(t), t !== "string" || i.uint8array ? t === "nodebuffer" ? new s(e) : i.uint8array ? new c(r.transformTo("uint8array", e)) : new a(r.transformTo("array", e)) : new o(e);
				};
			}, {
				"../support": 30,
				"../utils": 32,
				"./ArrayReader": 17,
				"./NodeBufferReader": 19,
				"./StringReader": 20,
				"./Uint8ArrayReader": 21
			}],
			23: [function(e, t, n) {
				n.LOCAL_FILE_HEADER = "PK", n.CENTRAL_FILE_HEADER = "PK", n.CENTRAL_DIRECTORY_END = "PK", n.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", n.ZIP64_CENTRAL_DIRECTORY_END = "PK", n.DATA_DESCRIPTOR = "PK\x07\b";
			}, {}],
			24: [function(e, t, n) {
				var r = e("./GenericWorker"), i = e("../utils");
				function a(e) {
					r.call(this, "ConvertWorker to " + e), this.destType = e;
				}
				i.inherits(a, r), a.prototype.processChunk = function(e) {
					this.push({
						data: i.transformTo(this.destType, e.data),
						meta: e.meta
					});
				}, t.exports = a;
			}, {
				"../utils": 32,
				"./GenericWorker": 28
			}],
			25: [function(e, t, n) {
				var r = e("./GenericWorker"), i = e("../crc32");
				function a() {
					r.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
				}
				e("../utils").inherits(a, r), a.prototype.processChunk = function(e) {
					this.streamInfo.crc32 = i(e.data, this.streamInfo.crc32 || 0), this.push(e);
				}, t.exports = a;
			}, {
				"../crc32": 4,
				"../utils": 32,
				"./GenericWorker": 28
			}],
			26: [function(e, t, n) {
				var r = e("../utils"), i = e("./GenericWorker");
				function a(e) {
					i.call(this, "DataLengthProbe for " + e), this.propName = e, this.withStreamInfo(e, 0);
				}
				r.inherits(a, i), a.prototype.processChunk = function(e) {
					if (e) {
						var t = this.streamInfo[this.propName] || 0;
						this.streamInfo[this.propName] = t + e.data.length;
					}
					i.prototype.processChunk.call(this, e);
				}, t.exports = a;
			}, {
				"../utils": 32,
				"./GenericWorker": 28
			}],
			27: [function(e, t, n) {
				var r = e("../utils"), i = e("./GenericWorker");
				function a(e) {
					i.call(this, "DataWorker");
					var t = this;
					this.dataIsReady = !1, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = !1, e.then(function(e) {
						t.dataIsReady = !0, t.data = e, t.max = e && e.length || 0, t.type = r.getTypeOf(e), t.isPaused || t._tickAndRepeat();
					}, function(e) {
						t.error(e);
					});
				}
				r.inherits(a, i), a.prototype.cleanUp = function() {
					i.prototype.cleanUp.call(this), this.data = null;
				}, a.prototype.resume = function() {
					return !!i.prototype.resume.call(this) && (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = !0, r.delay(this._tickAndRepeat, [], this)), !0);
				}, a.prototype._tickAndRepeat = function() {
					this._tickScheduled = !1, this.isPaused || this.isFinished || (this._tick(), this.isFinished || (r.delay(this._tickAndRepeat, [], this), this._tickScheduled = !0));
				}, a.prototype._tick = function() {
					if (this.isPaused || this.isFinished) return !1;
					var e = null, t = Math.min(this.max, this.index + 16384);
					if (this.index >= this.max) return this.end();
					switch (this.type) {
						case "string":
							e = this.data.substring(this.index, t);
							break;
						case "uint8array":
							e = this.data.subarray(this.index, t);
							break;
						case "array":
						case "nodebuffer": e = this.data.slice(this.index, t);
					}
					return this.index = t, this.push({
						data: e,
						meta: { percent: this.max ? this.index / this.max * 100 : 0 }
					});
				}, t.exports = a;
			}, {
				"../utils": 32,
				"./GenericWorker": 28
			}],
			28: [function(e, t, n) {
				function r(e) {
					this.name = e || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = !0, this.isFinished = !1, this.isLocked = !1, this._listeners = {
						data: [],
						end: [],
						error: []
					}, this.previous = null;
				}
				r.prototype = {
					push: function(e) {
						this.emit("data", e);
					},
					end: function() {
						if (this.isFinished) return !1;
						this.flush();
						try {
							this.emit("end"), this.cleanUp(), this.isFinished = !0;
						} catch (e) {
							this.emit("error", e);
						}
						return !0;
					},
					error: function(e) {
						return !this.isFinished && (this.isPaused ? this.generatedError = e : (this.isFinished = !0, this.emit("error", e), this.previous && this.previous.error(e), this.cleanUp()), !0);
					},
					on: function(e, t) {
						return this._listeners[e].push(t), this;
					},
					cleanUp: function() {
						this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
					},
					emit: function(e, t) {
						if (this._listeners[e]) for (var n = 0; n < this._listeners[e].length; n++) this._listeners[e][n].call(this, t);
					},
					pipe: function(e) {
						return e.registerPrevious(this);
					},
					registerPrevious: function(e) {
						if (this.isLocked) throw Error("The stream '" + this + "' has already been used.");
						this.streamInfo = e.streamInfo, this.mergeStreamInfo(), this.previous = e;
						var t = this;
						return e.on("data", function(e) {
							t.processChunk(e);
						}), e.on("end", function() {
							t.end();
						}), e.on("error", function(e) {
							t.error(e);
						}), this;
					},
					pause: function() {
						return !this.isPaused && !this.isFinished && (this.isPaused = !0, this.previous && this.previous.pause(), !0);
					},
					resume: function() {
						if (!this.isPaused || this.isFinished) return !1;
						var e = this.isPaused = !1;
						return this.generatedError && (this.error(this.generatedError), e = !0), this.previous && this.previous.resume(), !e;
					},
					flush: function() {},
					processChunk: function(e) {
						this.push(e);
					},
					withStreamInfo: function(e, t) {
						return this.extraStreamInfo[e] = t, this.mergeStreamInfo(), this;
					},
					mergeStreamInfo: function() {
						for (var e in this.extraStreamInfo) Object.prototype.hasOwnProperty.call(this.extraStreamInfo, e) && (this.streamInfo[e] = this.extraStreamInfo[e]);
					},
					lock: function() {
						if (this.isLocked) throw Error("The stream '" + this + "' has already been used.");
						this.isLocked = !0, this.previous && this.previous.lock();
					},
					toString: function() {
						var e = "Worker " + this.name;
						return this.previous ? this.previous + " -> " + e : e;
					}
				}, t.exports = r;
			}, {}],
			29: [function(e, t, n) {
				var r = e("../utils"), i = e("./ConvertWorker"), a = e("./GenericWorker"), o = e("../base64"), s = e("../support"), c = e("../external"), l = null;
				if (s.nodestream) try {
					l = e("../nodejs/NodejsStreamOutputAdapter");
				} catch {}
				function u(e, t) {
					return new c.Promise(function(n, i) {
						var a = [], s = e._internalType, c = e._outputType, l = e._mimeType;
						e.on("data", function(e, n) {
							a.push(e), t && t(n);
						}).on("error", function(e) {
							a = [], i(e);
						}).on("end", function() {
							try {
								n(function(e, t, n) {
									switch (e) {
										case "blob": return r.newBlob(r.transformTo("arraybuffer", t), n);
										case "base64": return o.encode(t);
										default: return r.transformTo(e, t);
									}
								}(c, function(e, t) {
									var n, r = 0, i = null, a = 0;
									for (n = 0; n < t.length; n++) a += t[n].length;
									switch (e) {
										case "string": return t.join("");
										case "array": return Array.prototype.concat.apply([], t);
										case "uint8array":
											for (i = new Uint8Array(a), n = 0; n < t.length; n++) i.set(t[n], r), r += t[n].length;
											return i;
										case "nodebuffer": return Buffer.concat(t);
										default: throw Error("concat : unsupported type '" + e + "'");
									}
								}(s, a), l));
							} catch (e) {
								i(e);
							}
							a = [];
						}).resume();
					});
				}
				function d(e, t, n) {
					var o = t;
					switch (t) {
						case "blob":
						case "arraybuffer":
							o = "uint8array";
							break;
						case "base64": o = "string";
					}
					try {
						this._internalType = o, this._outputType = t, this._mimeType = n, r.checkSupport(o), this._worker = e.pipe(new i(o)), e.lock();
					} catch (e) {
						this._worker = new a("error"), this._worker.error(e);
					}
				}
				d.prototype = {
					accumulate: function(e) {
						return u(this, e);
					},
					on: function(e, t) {
						var n = this;
						return e === "data" ? this._worker.on(e, function(e) {
							t.call(n, e.data, e.meta);
						}) : this._worker.on(e, function() {
							r.delay(t, arguments, n);
						}), this;
					},
					resume: function() {
						return r.delay(this._worker.resume, [], this._worker), this;
					},
					pause: function() {
						return this._worker.pause(), this;
					},
					toNodejsStream: function(e) {
						if (r.checkSupport("nodestream"), this._outputType !== "nodebuffer") throw Error(this._outputType + " is not supported by this method");
						return new l(this, { objectMode: this._outputType !== "nodebuffer" }, e);
					}
				}, t.exports = d;
			}, {
				"../base64": 1,
				"../external": 6,
				"../nodejs/NodejsStreamOutputAdapter": 13,
				"../support": 30,
				"../utils": 32,
				"./ConvertWorker": 24,
				"./GenericWorker": 28
			}],
			30: [function(e, t, n) {
				if (n.base64 = !0, n.array = !0, n.string = !0, n.arraybuffer = typeof ArrayBuffer < "u" && typeof Uint8Array < "u", n.nodebuffer = typeof Buffer < "u", n.uint8array = typeof Uint8Array < "u", typeof ArrayBuffer > "u") n.blob = !1;
				else {
					var r = /* @__PURE__ */ new ArrayBuffer(0);
					try {
						n.blob = new Blob([r], { type: "application/zip" }).size === 0;
					} catch {
						try {
							var i = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
							i.append(r), n.blob = i.getBlob("application/zip").size === 0;
						} catch {
							n.blob = !1;
						}
					}
				}
				try {
					n.nodestream = !!e("readable-stream").Readable;
				} catch {
					n.nodestream = !1;
				}
			}, { "readable-stream": 16 }],
			31: [function(e, t, n) {
				for (var r = e("./utils"), i = e("./support"), a = e("./nodejsUtils"), o = e("./stream/GenericWorker"), s = Array(256), c = 0; c < 256; c++) s[c] = 252 <= c ? 6 : 248 <= c ? 5 : 240 <= c ? 4 : 224 <= c ? 3 : 192 <= c ? 2 : 1;
				s[254] = s[254] = 1;
				function l() {
					o.call(this, "utf-8 decode"), this.leftOver = null;
				}
				function u() {
					o.call(this, "utf-8 encode");
				}
				n.utf8encode = function(e) {
					return i.nodebuffer ? a.newBufferFrom(e, "utf-8") : function(e) {
						var t, n, r, a, o, s = e.length, c = 0;
						for (a = 0; a < s; a++) (64512 & (n = e.charCodeAt(a))) == 55296 && a + 1 < s && (64512 & (r = e.charCodeAt(a + 1))) == 56320 && (n = 65536 + (n - 55296 << 10) + (r - 56320), a++), c += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
						for (t = i.uint8array ? new Uint8Array(c) : Array(c), a = o = 0; o < c; a++) (64512 & (n = e.charCodeAt(a))) == 55296 && a + 1 < s && (64512 & (r = e.charCodeAt(a + 1))) == 56320 && (n = 65536 + (n - 55296 << 10) + (r - 56320), a++), n < 128 ? t[o++] = n : (n < 2048 ? t[o++] = 192 | n >>> 6 : (n < 65536 ? t[o++] = 224 | n >>> 12 : (t[o++] = 240 | n >>> 18, t[o++] = 128 | n >>> 12 & 63), t[o++] = 128 | n >>> 6 & 63), t[o++] = 128 | 63 & n);
						return t;
					}(e);
				}, n.utf8decode = function(e) {
					return i.nodebuffer ? r.transformTo("nodebuffer", e).toString("utf-8") : function(e) {
						var t, n, i, a, o = e.length, c = Array(2 * o);
						for (t = n = 0; t < o;) if ((i = e[t++]) < 128) c[n++] = i;
						else if (4 < (a = s[i])) c[n++] = 65533, t += a - 1;
						else {
							for (i &= a === 2 ? 31 : a === 3 ? 15 : 7; 1 < a && t < o;) i = i << 6 | 63 & e[t++], a--;
							1 < a ? c[n++] = 65533 : i < 65536 ? c[n++] = i : (i -= 65536, c[n++] = 55296 | i >> 10 & 1023, c[n++] = 56320 | 1023 & i);
						}
						return c.length !== n && (c.subarray ? c = c.subarray(0, n) : c.length = n), r.applyFromCharCode(c);
					}(e = r.transformTo(i.uint8array ? "uint8array" : "array", e));
				}, r.inherits(l, o), l.prototype.processChunk = function(e) {
					var t = r.transformTo(i.uint8array ? "uint8array" : "array", e.data);
					if (this.leftOver && this.leftOver.length) {
						if (i.uint8array) {
							var a = t;
							(t = new Uint8Array(a.length + this.leftOver.length)).set(this.leftOver, 0), t.set(a, this.leftOver.length);
						} else t = this.leftOver.concat(t);
						this.leftOver = null;
					}
					var o = function(e, t) {
						var n;
						for ((t = t || e.length) > e.length && (t = e.length), n = t - 1; 0 <= n && (192 & e[n]) == 128;) n--;
						return n < 0 || n === 0 ? t : n + s[e[n]] > t ? n : t;
					}(t), c = t;
					o !== t.length && (i.uint8array ? (c = t.subarray(0, o), this.leftOver = t.subarray(o, t.length)) : (c = t.slice(0, o), this.leftOver = t.slice(o, t.length))), this.push({
						data: n.utf8decode(c),
						meta: e.meta
					});
				}, l.prototype.flush = function() {
					this.leftOver && this.leftOver.length && (this.push({
						data: n.utf8decode(this.leftOver),
						meta: {}
					}), this.leftOver = null);
				}, n.Utf8DecodeWorker = l, r.inherits(u, o), u.prototype.processChunk = function(e) {
					this.push({
						data: n.utf8encode(e.data),
						meta: e.meta
					});
				}, n.Utf8EncodeWorker = u;
			}, {
				"./nodejsUtils": 14,
				"./stream/GenericWorker": 28,
				"./support": 30,
				"./utils": 32
			}],
			32: [function(e, t, n) {
				var r = e("./support"), i = e("./base64"), a = e("./nodejsUtils"), o = e("./external");
				function s(e) {
					return e;
				}
				function c(e, t) {
					for (var n = 0; n < e.length; ++n) t[n] = 255 & e.charCodeAt(n);
					return t;
				}
				e("setimmediate"), n.newBlob = function(e, t) {
					n.checkSupport("blob");
					try {
						return new Blob([e], { type: t });
					} catch {
						try {
							var r = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
							return r.append(e), r.getBlob(t);
						} catch {
							throw Error("Bug : can't construct the Blob.");
						}
					}
				};
				var l = {
					stringifyByChunk: function(e, t, n) {
						var r = [], i = 0, a = e.length;
						if (a <= n) return String.fromCharCode.apply(null, e);
						for (; i < a;) t === "array" || t === "nodebuffer" ? r.push(String.fromCharCode.apply(null, e.slice(i, Math.min(i + n, a)))) : r.push(String.fromCharCode.apply(null, e.subarray(i, Math.min(i + n, a)))), i += n;
						return r.join("");
					},
					stringifyByChar: function(e) {
						for (var t = "", n = 0; n < e.length; n++) t += String.fromCharCode(e[n]);
						return t;
					},
					applyCanBeUsed: {
						uint8array: function() {
							try {
								return r.uint8array && String.fromCharCode.apply(null, new Uint8Array(1)).length === 1;
							} catch {
								return !1;
							}
						}(),
						nodebuffer: function() {
							try {
								return r.nodebuffer && String.fromCharCode.apply(null, a.allocBuffer(1)).length === 1;
							} catch {
								return !1;
							}
						}()
					}
				};
				function u(e) {
					var t = 65536, r = n.getTypeOf(e), i = !0;
					if (r === "uint8array" ? i = l.applyCanBeUsed.uint8array : r === "nodebuffer" && (i = l.applyCanBeUsed.nodebuffer), i) for (; 1 < t;) try {
						return l.stringifyByChunk(e, r, t);
					} catch {
						t = Math.floor(t / 2);
					}
					return l.stringifyByChar(e);
				}
				function d(e, t) {
					for (var n = 0; n < e.length; n++) t[n] = e[n];
					return t;
				}
				n.applyFromCharCode = u;
				var f = {};
				f.string = {
					string: s,
					array: function(e) {
						return c(e, Array(e.length));
					},
					arraybuffer: function(e) {
						return f.string.uint8array(e).buffer;
					},
					uint8array: function(e) {
						return c(e, new Uint8Array(e.length));
					},
					nodebuffer: function(e) {
						return c(e, a.allocBuffer(e.length));
					}
				}, f.array = {
					string: u,
					array: s,
					arraybuffer: function(e) {
						return new Uint8Array(e).buffer;
					},
					uint8array: function(e) {
						return new Uint8Array(e);
					},
					nodebuffer: function(e) {
						return a.newBufferFrom(e);
					}
				}, f.arraybuffer = {
					string: function(e) {
						return u(new Uint8Array(e));
					},
					array: function(e) {
						return d(new Uint8Array(e), Array(e.byteLength));
					},
					arraybuffer: s,
					uint8array: function(e) {
						return new Uint8Array(e);
					},
					nodebuffer: function(e) {
						return a.newBufferFrom(new Uint8Array(e));
					}
				}, f.uint8array = {
					string: u,
					array: function(e) {
						return d(e, Array(e.length));
					},
					arraybuffer: function(e) {
						return e.buffer;
					},
					uint8array: s,
					nodebuffer: function(e) {
						return a.newBufferFrom(e);
					}
				}, f.nodebuffer = {
					string: u,
					array: function(e) {
						return d(e, Array(e.length));
					},
					arraybuffer: function(e) {
						return f.nodebuffer.uint8array(e).buffer;
					},
					uint8array: function(e) {
						return d(e, new Uint8Array(e.length));
					},
					nodebuffer: s
				}, n.transformTo = function(e, t) {
					return t = t || "", e ? (n.checkSupport(e), f[n.getTypeOf(t)][e](t)) : t;
				}, n.resolve = function(e) {
					for (var t = e.split("/"), n = [], r = 0; r < t.length; r++) {
						var i = t[r];
						i === "." || i === "" && r !== 0 && r !== t.length - 1 || (i === ".." ? n.pop() : n.push(i));
					}
					return n.join("/");
				}, n.getTypeOf = function(e) {
					return typeof e == "string" ? "string" : Object.prototype.toString.call(e) === "[object Array]" ? "array" : r.nodebuffer && a.isBuffer(e) ? "nodebuffer" : r.uint8array && e instanceof Uint8Array ? "uint8array" : r.arraybuffer && e instanceof ArrayBuffer ? "arraybuffer" : void 0;
				}, n.checkSupport = function(e) {
					if (!r[e.toLowerCase()]) throw Error(e + " is not supported by this platform");
				}, n.MAX_VALUE_16BITS = 65535, n.MAX_VALUE_32BITS = -1, n.pretty = function(e) {
					var t, n, r = "";
					for (n = 0; n < (e || "").length; n++) r += "\\x" + ((t = e.charCodeAt(n)) < 16 ? "0" : "") + t.toString(16).toUpperCase();
					return r;
				}, n.delay = function(e, t, n) {
					setImmediate(function() {
						e.apply(n || null, t || []);
					});
				}, n.inherits = function(e, t) {
					function n() {}
					n.prototype = t.prototype, e.prototype = new n();
				}, n.extend = function() {
					var e, t, n = {};
					for (e = 0; e < arguments.length; e++) for (t in arguments[e]) Object.prototype.hasOwnProperty.call(arguments[e], t) && n[t] === void 0 && (n[t] = arguments[e][t]);
					return n;
				}, n.prepareContent = function(e, t, a, s, l) {
					return o.Promise.resolve(t).then(function(e) {
						return r.blob && (e instanceof Blob || ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(e)) !== -1) && typeof FileReader < "u" ? new o.Promise(function(t, n) {
							var r = new FileReader();
							r.onload = function(e) {
								t(e.target.result);
							}, r.onerror = function(e) {
								n(e.target.error);
							}, r.readAsArrayBuffer(e);
						}) : e;
					}).then(function(t) {
						var u = n.getTypeOf(t);
						return u ? (u === "arraybuffer" ? t = n.transformTo("uint8array", t) : u === "string" && (l ? t = i.decode(t) : a && !0 !== s && (t = function(e) {
							return c(e, r.uint8array ? new Uint8Array(e.length) : Array(e.length));
						}(t))), t) : o.Promise.reject(/* @__PURE__ */ Error("Can't read the data of '" + e + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"));
					});
				};
			}, {
				"./base64": 1,
				"./external": 6,
				"./nodejsUtils": 14,
				"./support": 30,
				setimmediate: 54
			}],
			33: [function(e, t, n) {
				var r = e("./reader/readerFor"), i = e("./utils"), a = e("./signature"), o = e("./zipEntry"), s = e("./support");
				function c(e) {
					this.files = [], this.loadOptions = e;
				}
				c.prototype = {
					checkSignature: function(e) {
						if (!this.reader.readAndCheckSignature(e)) {
							this.reader.index -= 4;
							var t = this.reader.readString(4);
							throw Error("Corrupted zip or bug: unexpected signature (" + i.pretty(t) + ", expected " + i.pretty(e) + ")");
						}
					},
					isSignature: function(e, t) {
						var n = this.reader.index;
						this.reader.setIndex(e);
						var r = this.reader.readString(4) === t;
						return this.reader.setIndex(n), r;
					},
					readBlockEndOfCentral: function() {
						this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
						var e = this.reader.readData(this.zipCommentLength), t = s.uint8array ? "uint8array" : "array", n = i.transformTo(t, e);
						this.zipComment = this.loadOptions.decodeFileName(n);
					},
					readBlockZip64EndOfCentral: function() {
						this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
						for (var e, t, n, r = this.zip64EndOfCentralSize - 44; 0 < r;) e = this.reader.readInt(2), t = this.reader.readInt(4), n = this.reader.readData(t), this.zip64ExtensibleData[e] = {
							id: e,
							length: t,
							value: n
						};
					},
					readBlockZip64EndOfCentralLocator: function() {
						if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), 1 < this.disksCount) throw Error("Multi-volumes zip are not supported");
					},
					readLocalFiles: function() {
						var e, t;
						for (e = 0; e < this.files.length; e++) t = this.files[e], this.reader.setIndex(t.localHeaderOffset), this.checkSignature(a.LOCAL_FILE_HEADER), t.readLocalPart(this.reader), t.handleUTF8(), t.processAttributes();
					},
					readCentralDir: function() {
						var e;
						for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(a.CENTRAL_FILE_HEADER);) (e = new o({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(e);
						if (this.centralDirRecords !== this.files.length && this.centralDirRecords !== 0 && this.files.length === 0) throw Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
					},
					readEndOfCentral: function() {
						var e = this.reader.lastIndexOfSignature(a.CENTRAL_DIRECTORY_END);
						if (e < 0) throw this.isSignature(0, a.LOCAL_FILE_HEADER) ? /* @__PURE__ */ Error("Corrupted zip: can't find end of central directory") : /* @__PURE__ */ Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html");
						this.reader.setIndex(e);
						var t = e;
						if (this.checkSignature(a.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === i.MAX_VALUE_16BITS || this.diskWithCentralDirStart === i.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === i.MAX_VALUE_16BITS || this.centralDirRecords === i.MAX_VALUE_16BITS || this.centralDirSize === i.MAX_VALUE_32BITS || this.centralDirOffset === i.MAX_VALUE_32BITS) {
							if (this.zip64 = !0, (e = this.reader.lastIndexOfSignature(a.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0) throw Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
							if (this.reader.setIndex(e), this.checkSignature(a.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, a.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(a.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0)) throw Error("Corrupted zip: can't find the ZIP64 end of central directory");
							this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(a.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
						}
						var n = this.centralDirOffset + this.centralDirSize;
						this.zip64 && (n += 20, n += 12 + this.zip64EndOfCentralSize);
						var r = t - n;
						if (0 < r) this.isSignature(t, a.CENTRAL_FILE_HEADER) || (this.reader.zero = r);
						else if (r < 0) throw Error("Corrupted zip: missing " + Math.abs(r) + " bytes.");
					},
					prepareReader: function(e) {
						this.reader = r(e);
					},
					load: function(e) {
						this.prepareReader(e), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
					}
				}, t.exports = c;
			}, {
				"./reader/readerFor": 22,
				"./signature": 23,
				"./support": 30,
				"./utils": 32,
				"./zipEntry": 34
			}],
			34: [function(e, t, n) {
				var r = e("./reader/readerFor"), i = e("./utils"), a = e("./compressedObject"), o = e("./crc32"), s = e("./utf8"), c = e("./compressions"), l = e("./support");
				function u(e, t) {
					this.options = e, this.loadOptions = t;
				}
				u.prototype = {
					isEncrypted: function() {
						return (1 & this.bitFlag) == 1;
					},
					useUTF8: function() {
						return (2048 & this.bitFlag) == 2048;
					},
					readLocalPart: function(e) {
						var t, n;
						if (e.skip(22), this.fileNameLength = e.readInt(2), n = e.readInt(2), this.fileName = e.readData(this.fileNameLength), e.skip(n), this.compressedSize === -1 || this.uncompressedSize === -1) throw Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
						if ((t = function(e) {
							for (var t in c) if (Object.prototype.hasOwnProperty.call(c, t) && c[t].magic === e) return c[t];
							return null;
						}(this.compressionMethod)) === null) throw Error("Corrupted zip : compression " + i.pretty(this.compressionMethod) + " unknown (inner file : " + i.transformTo("string", this.fileName) + ")");
						this.decompressed = new a(this.compressedSize, this.uncompressedSize, this.crc32, t, e.readData(this.compressedSize));
					},
					readCentralPart: function(e) {
						this.versionMadeBy = e.readInt(2), e.skip(2), this.bitFlag = e.readInt(2), this.compressionMethod = e.readString(2), this.date = e.readDate(), this.crc32 = e.readInt(4), this.compressedSize = e.readInt(4), this.uncompressedSize = e.readInt(4);
						var t = e.readInt(2);
						if (this.extraFieldsLength = e.readInt(2), this.fileCommentLength = e.readInt(2), this.diskNumberStart = e.readInt(2), this.internalFileAttributes = e.readInt(2), this.externalFileAttributes = e.readInt(4), this.localHeaderOffset = e.readInt(4), this.isEncrypted()) throw Error("Encrypted zip are not supported");
						e.skip(t), this.readExtraFields(e), this.parseZIP64ExtraField(e), this.fileComment = e.readData(this.fileCommentLength);
					},
					processAttributes: function() {
						this.unixPermissions = null, this.dosPermissions = null;
						var e = this.versionMadeBy >> 8;
						this.dir = !!(16 & this.externalFileAttributes), e == 0 && (this.dosPermissions = 63 & this.externalFileAttributes), e == 3 && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), this.dir || this.fileNameStr.slice(-1) !== "/" || (this.dir = !0);
					},
					parseZIP64ExtraField: function() {
						if (this.extraFields[1]) {
							var e = r(this.extraFields[1].value);
							this.uncompressedSize === i.MAX_VALUE_32BITS && (this.uncompressedSize = e.readInt(8)), this.compressedSize === i.MAX_VALUE_32BITS && (this.compressedSize = e.readInt(8)), this.localHeaderOffset === i.MAX_VALUE_32BITS && (this.localHeaderOffset = e.readInt(8)), this.diskNumberStart === i.MAX_VALUE_32BITS && (this.diskNumberStart = e.readInt(4));
						}
					},
					readExtraFields: function(e) {
						var t, n, r, i = e.index + this.extraFieldsLength;
						for (this.extraFields || (this.extraFields = {}); e.index + 4 < i;) t = e.readInt(2), n = e.readInt(2), r = e.readData(n), this.extraFields[t] = {
							id: t,
							length: n,
							value: r
						};
						e.setIndex(i);
					},
					handleUTF8: function() {
						var e = l.uint8array ? "uint8array" : "array";
						if (this.useUTF8()) this.fileNameStr = s.utf8decode(this.fileName), this.fileCommentStr = s.utf8decode(this.fileComment);
						else {
							var t = this.findExtraFieldUnicodePath();
							if (t !== null) this.fileNameStr = t;
							else {
								var n = i.transformTo(e, this.fileName);
								this.fileNameStr = this.loadOptions.decodeFileName(n);
							}
							var r = this.findExtraFieldUnicodeComment();
							if (r !== null) this.fileCommentStr = r;
							else {
								var a = i.transformTo(e, this.fileComment);
								this.fileCommentStr = this.loadOptions.decodeFileName(a);
							}
						}
					},
					findExtraFieldUnicodePath: function() {
						var e = this.extraFields[28789];
						if (e) {
							var t = r(e.value);
							return t.readInt(1) === 1 && o(this.fileName) === t.readInt(4) ? s.utf8decode(t.readData(e.length - 5)) : null;
						}
						return null;
					},
					findExtraFieldUnicodeComment: function() {
						var e = this.extraFields[25461];
						if (e) {
							var t = r(e.value);
							return t.readInt(1) === 1 && o(this.fileComment) === t.readInt(4) ? s.utf8decode(t.readData(e.length - 5)) : null;
						}
						return null;
					}
				}, t.exports = u;
			}, {
				"./compressedObject": 2,
				"./compressions": 3,
				"./crc32": 4,
				"./reader/readerFor": 22,
				"./support": 30,
				"./utf8": 31,
				"./utils": 32
			}],
			35: [function(e, t, n) {
				function r(e, t, n) {
					this.name = e, this.dir = n.dir, this.date = n.date, this.comment = n.comment, this.unixPermissions = n.unixPermissions, this.dosPermissions = n.dosPermissions, this._data = t, this._dataBinary = n.binary, this.options = {
						compression: n.compression,
						compressionOptions: n.compressionOptions
					};
				}
				var i = e("./stream/StreamHelper"), a = e("./stream/DataWorker"), o = e("./utf8"), s = e("./compressedObject"), c = e("./stream/GenericWorker");
				r.prototype = {
					internalStream: function(e) {
						var t = null, n = "string";
						try {
							if (!e) throw Error("No output type specified.");
							var r = (n = e.toLowerCase()) === "string" || n === "text";
							n !== "binarystring" && n !== "text" || (n = "string"), t = this._decompressWorker();
							var a = !this._dataBinary;
							a && !r && (t = t.pipe(new o.Utf8EncodeWorker())), !a && r && (t = t.pipe(new o.Utf8DecodeWorker()));
						} catch (e) {
							(t = new c("error")).error(e);
						}
						return new i(t, n, "");
					},
					async: function(e, t) {
						return this.internalStream(e).accumulate(t);
					},
					nodeStream: function(e, t) {
						return this.internalStream(e || "nodebuffer").toNodejsStream(t);
					},
					_compressWorker: function(e, t) {
						if (this._data instanceof s && this._data.compression.magic === e.magic) return this._data.getCompressedWorker();
						var n = this._decompressWorker();
						return this._dataBinary || (n = n.pipe(new o.Utf8EncodeWorker())), s.createWorkerFrom(n, e, t);
					},
					_decompressWorker: function() {
						return this._data instanceof s ? this._data.getContentWorker() : this._data instanceof c ? this._data : new a(this._data);
					}
				};
				for (var l = [
					"asText",
					"asBinary",
					"asNodeBuffer",
					"asUint8Array",
					"asArrayBuffer"
				], u = function() {
					throw Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
				}, d = 0; d < l.length; d++) r.prototype[l[d]] = u;
				t.exports = r;
			}, {
				"./compressedObject": 2,
				"./stream/DataWorker": 27,
				"./stream/GenericWorker": 28,
				"./stream/StreamHelper": 29,
				"./utf8": 31
			}],
			36: [function(e, t, n) {
				(function(e) {
					var n, r, i = e.MutationObserver || e.WebKitMutationObserver;
					if (i) {
						var a = 0, o = new i(u), s = e.document.createTextNode("");
						o.observe(s, { characterData: !0 }), n = function() {
							s.data = a = ++a % 2;
						};
					} else if (e.setImmediate || e.MessageChannel === void 0) n = "document" in e && "onreadystatechange" in e.document.createElement("script") ? function() {
						var t = e.document.createElement("script");
						t.onreadystatechange = function() {
							u(), t.onreadystatechange = null, t.parentNode.removeChild(t), t = null;
						}, e.document.documentElement.appendChild(t);
					} : function() {
						setTimeout(u, 0);
					};
					else {
						var c = new e.MessageChannel();
						c.port1.onmessage = u, n = function() {
							c.port2.postMessage(0);
						};
					}
					var l = [];
					function u() {
						var e, t;
						r = !0;
						for (var n = l.length; n;) {
							for (t = l, l = [], e = -1; ++e < n;) t[e]();
							n = l.length;
						}
						r = !1;
					}
					t.exports = function(e) {
						l.push(e) !== 1 || r || n();
					};
				}).call(this, typeof global < "u" ? global : typeof self < "u" ? self : typeof window < "u" ? window : {});
			}, {}],
			37: [function(e, t, n) {
				var r = e("immediate");
				function i() {}
				var a = {}, o = ["REJECTED"], s = ["FULFILLED"], c = ["PENDING"];
				function l(e) {
					if (typeof e != "function") throw TypeError("resolver must be a function");
					this.state = c, this.queue = [], this.outcome = void 0, e !== i && p(this, e);
				}
				function u(e, t, n) {
					this.promise = e, typeof t == "function" && (this.onFulfilled = t, this.callFulfilled = this.otherCallFulfilled), typeof n == "function" && (this.onRejected = n, this.callRejected = this.otherCallRejected);
				}
				function d(e, t, n) {
					r(function() {
						var r;
						try {
							r = t(n);
						} catch (t) {
							return a.reject(e, t);
						}
						r === e ? a.reject(e, /* @__PURE__ */ TypeError("Cannot resolve promise with itself")) : a.resolve(e, r);
					});
				}
				function f(e) {
					var t = e && e.then;
					if (e && (typeof e == "object" || typeof e == "function") && typeof t == "function") return function() {
						t.apply(e, arguments);
					};
				}
				function p(e, t) {
					var n = !1;
					function r(t) {
						n || (n = !0, a.reject(e, t));
					}
					function i(t) {
						n || (n = !0, a.resolve(e, t));
					}
					var o = m(function() {
						t(i, r);
					});
					o.status === "error" && r(o.value);
				}
				function m(e, t) {
					var n = {};
					try {
						n.value = e(t), n.status = "success";
					} catch (e) {
						n.status = "error", n.value = e;
					}
					return n;
				}
				(t.exports = l).prototype.finally = function(e) {
					if (typeof e != "function") return this;
					var t = this.constructor;
					return this.then(function(n) {
						return t.resolve(e()).then(function() {
							return n;
						});
					}, function(n) {
						return t.resolve(e()).then(function() {
							throw n;
						});
					});
				}, l.prototype.catch = function(e) {
					return this.then(null, e);
				}, l.prototype.then = function(e, t) {
					if (typeof e != "function" && this.state === s || typeof t != "function" && this.state === o) return this;
					var n = new this.constructor(i);
					return this.state === c ? this.queue.push(new u(n, e, t)) : d(n, this.state === s ? e : t, this.outcome), n;
				}, u.prototype.callFulfilled = function(e) {
					a.resolve(this.promise, e);
				}, u.prototype.otherCallFulfilled = function(e) {
					d(this.promise, this.onFulfilled, e);
				}, u.prototype.callRejected = function(e) {
					a.reject(this.promise, e);
				}, u.prototype.otherCallRejected = function(e) {
					d(this.promise, this.onRejected, e);
				}, a.resolve = function(e, t) {
					var n = m(f, t);
					if (n.status === "error") return a.reject(e, n.value);
					var r = n.value;
					if (r) p(e, r);
					else {
						e.state = s, e.outcome = t;
						for (var i = -1, o = e.queue.length; ++i < o;) e.queue[i].callFulfilled(t);
					}
					return e;
				}, a.reject = function(e, t) {
					e.state = o, e.outcome = t;
					for (var n = -1, r = e.queue.length; ++n < r;) e.queue[n].callRejected(t);
					return e;
				}, l.resolve = function(e) {
					return e instanceof this ? e : a.resolve(new this(i), e);
				}, l.reject = function(e) {
					var t = new this(i);
					return a.reject(t, e);
				}, l.all = function(e) {
					var t = this;
					if (Object.prototype.toString.call(e) !== "[object Array]") return this.reject(/* @__PURE__ */ TypeError("must be an array"));
					var n = e.length, r = !1;
					if (!n) return this.resolve([]);
					for (var o = Array(n), s = 0, c = -1, l = new this(i); ++c < n;) u(e[c], c);
					return l;
					function u(e, i) {
						t.resolve(e).then(function(e) {
							o[i] = e, ++s !== n || r || (r = !0, a.resolve(l, o));
						}, function(e) {
							r || (r = !0, a.reject(l, e));
						});
					}
				}, l.race = function(e) {
					var t = this;
					if (Object.prototype.toString.call(e) !== "[object Array]") return this.reject(/* @__PURE__ */ TypeError("must be an array"));
					var n = e.length, r = !1;
					if (!n) return this.resolve([]);
					for (var o = -1, s = new this(i); ++o < n;) c = e[o], t.resolve(c).then(function(e) {
						r || (r = !0, a.resolve(s, e));
					}, function(e) {
						r || (r = !0, a.reject(s, e));
					});
					var c;
					return s;
				};
			}, { immediate: 36 }],
			38: [function(e, t, n) {
				var r = {};
				(0, e("./lib/utils/common").assign)(r, e("./lib/deflate"), e("./lib/inflate"), e("./lib/zlib/constants")), t.exports = r;
			}, {
				"./lib/deflate": 39,
				"./lib/inflate": 40,
				"./lib/utils/common": 41,
				"./lib/zlib/constants": 44
			}],
			39: [function(e, t, n) {
				var r = e("./zlib/deflate"), i = e("./utils/common"), a = e("./utils/strings"), o = e("./zlib/messages"), s = e("./zlib/zstream"), c = Object.prototype.toString, l = 0, u = -1, d = 0, f = 8;
				function p(e) {
					if (!(this instanceof p)) return new p(e);
					this.options = i.assign({
						level: u,
						method: f,
						chunkSize: 16384,
						windowBits: 15,
						memLevel: 8,
						strategy: d,
						to: ""
					}, e || {});
					var t = this.options;
					t.raw && 0 < t.windowBits ? t.windowBits = -t.windowBits : t.gzip && 0 < t.windowBits && t.windowBits < 16 && (t.windowBits += 16), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new s(), this.strm.avail_out = 0;
					var n = r.deflateInit2(this.strm, t.level, t.method, t.windowBits, t.memLevel, t.strategy);
					if (n !== l) throw Error(o[n]);
					if (t.header && r.deflateSetHeader(this.strm, t.header), t.dictionary) {
						var m;
						if (m = typeof t.dictionary == "string" ? a.string2buf(t.dictionary) : c.call(t.dictionary) === "[object ArrayBuffer]" ? new Uint8Array(t.dictionary) : t.dictionary, (n = r.deflateSetDictionary(this.strm, m)) !== l) throw Error(o[n]);
						this._dict_set = !0;
					}
				}
				function m(e, t) {
					var n = new p(t);
					if (n.push(e, !0), n.err) throw n.msg || o[n.err];
					return n.result;
				}
				p.prototype.push = function(e, t) {
					var n, o, s = this.strm, u = this.options.chunkSize;
					if (this.ended) return !1;
					o = t === ~~t ? t : !0 === t ? 4 : 0, typeof e == "string" ? s.input = a.string2buf(e) : c.call(e) === "[object ArrayBuffer]" ? s.input = new Uint8Array(e) : s.input = e, s.next_in = 0, s.avail_in = s.input.length;
					do {
						if (s.avail_out === 0 && (s.output = new i.Buf8(u), s.next_out = 0, s.avail_out = u), (n = r.deflate(s, o)) !== 1 && n !== l) return this.onEnd(n), !(this.ended = !0);
						s.avail_out !== 0 && (s.avail_in !== 0 || o !== 4 && o !== 2) || (this.options.to === "string" ? this.onData(a.buf2binstring(i.shrinkBuf(s.output, s.next_out))) : this.onData(i.shrinkBuf(s.output, s.next_out)));
					} while ((0 < s.avail_in || s.avail_out === 0) && n !== 1);
					return o === 4 ? (n = r.deflateEnd(this.strm), this.onEnd(n), this.ended = !0, n === l) : o !== 2 || (this.onEnd(l), !(s.avail_out = 0));
				}, p.prototype.onData = function(e) {
					this.chunks.push(e);
				}, p.prototype.onEnd = function(e) {
					e === l && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = i.flattenChunks(this.chunks)), this.chunks = [], this.err = e, this.msg = this.strm.msg;
				}, n.Deflate = p, n.deflate = m, n.deflateRaw = function(e, t) {
					return (t = t || {}).raw = !0, m(e, t);
				}, n.gzip = function(e, t) {
					return (t = t || {}).gzip = !0, m(e, t);
				};
			}, {
				"./utils/common": 41,
				"./utils/strings": 42,
				"./zlib/deflate": 46,
				"./zlib/messages": 51,
				"./zlib/zstream": 53
			}],
			40: [function(e, t, n) {
				var r = e("./zlib/inflate"), i = e("./utils/common"), a = e("./utils/strings"), o = e("./zlib/constants"), s = e("./zlib/messages"), c = e("./zlib/zstream"), l = e("./zlib/gzheader"), u = Object.prototype.toString;
				function d(e) {
					if (!(this instanceof d)) return new d(e);
					this.options = i.assign({
						chunkSize: 16384,
						windowBits: 0,
						to: ""
					}, e || {});
					var t = this.options;
					t.raw && 0 <= t.windowBits && t.windowBits < 16 && (t.windowBits = -t.windowBits, t.windowBits === 0 && (t.windowBits = -15)), !(0 <= t.windowBits && t.windowBits < 16) || e && e.windowBits || (t.windowBits += 32), 15 < t.windowBits && t.windowBits < 48 && !(15 & t.windowBits) && (t.windowBits |= 15), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new c(), this.strm.avail_out = 0;
					var n = r.inflateInit2(this.strm, t.windowBits);
					if (n !== o.Z_OK) throw Error(s[n]);
					this.header = new l(), r.inflateGetHeader(this.strm, this.header);
				}
				function f(e, t) {
					var n = new d(t);
					if (n.push(e, !0), n.err) throw n.msg || s[n.err];
					return n.result;
				}
				d.prototype.push = function(e, t) {
					var n, s, c, l, d, f, p = this.strm, m = this.options.chunkSize, h = this.options.dictionary, g = !1;
					if (this.ended) return !1;
					s = t === ~~t ? t : !0 === t ? o.Z_FINISH : o.Z_NO_FLUSH, typeof e == "string" ? p.input = a.binstring2buf(e) : u.call(e) === "[object ArrayBuffer]" ? p.input = new Uint8Array(e) : p.input = e, p.next_in = 0, p.avail_in = p.input.length;
					do {
						if (p.avail_out === 0 && (p.output = new i.Buf8(m), p.next_out = 0, p.avail_out = m), (n = r.inflate(p, o.Z_NO_FLUSH)) === o.Z_NEED_DICT && h && (f = typeof h == "string" ? a.string2buf(h) : u.call(h) === "[object ArrayBuffer]" ? new Uint8Array(h) : h, n = r.inflateSetDictionary(this.strm, f)), n === o.Z_BUF_ERROR && !0 === g && (n = o.Z_OK, g = !1), n !== o.Z_STREAM_END && n !== o.Z_OK) return this.onEnd(n), !(this.ended = !0);
						p.next_out && (p.avail_out !== 0 && n !== o.Z_STREAM_END && (p.avail_in !== 0 || s !== o.Z_FINISH && s !== o.Z_SYNC_FLUSH) || (this.options.to === "string" ? (c = a.utf8border(p.output, p.next_out), l = p.next_out - c, d = a.buf2string(p.output, c), p.next_out = l, p.avail_out = m - l, l && i.arraySet(p.output, p.output, c, l, 0), this.onData(d)) : this.onData(i.shrinkBuf(p.output, p.next_out)))), p.avail_in === 0 && p.avail_out === 0 && (g = !0);
					} while ((0 < p.avail_in || p.avail_out === 0) && n !== o.Z_STREAM_END);
					return n === o.Z_STREAM_END && (s = o.Z_FINISH), s === o.Z_FINISH ? (n = r.inflateEnd(this.strm), this.onEnd(n), this.ended = !0, n === o.Z_OK) : s !== o.Z_SYNC_FLUSH || (this.onEnd(o.Z_OK), !(p.avail_out = 0));
				}, d.prototype.onData = function(e) {
					this.chunks.push(e);
				}, d.prototype.onEnd = function(e) {
					e === o.Z_OK && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = i.flattenChunks(this.chunks)), this.chunks = [], this.err = e, this.msg = this.strm.msg;
				}, n.Inflate = d, n.inflate = f, n.inflateRaw = function(e, t) {
					return (t = t || {}).raw = !0, f(e, t);
				}, n.ungzip = f;
			}, {
				"./utils/common": 41,
				"./utils/strings": 42,
				"./zlib/constants": 44,
				"./zlib/gzheader": 47,
				"./zlib/inflate": 49,
				"./zlib/messages": 51,
				"./zlib/zstream": 53
			}],
			41: [function(e, t, n) {
				var r = typeof Uint8Array < "u" && typeof Uint16Array < "u" && typeof Int32Array < "u";
				n.assign = function(e) {
					for (var t = Array.prototype.slice.call(arguments, 1); t.length;) {
						var n = t.shift();
						if (n) {
							if (typeof n != "object") throw TypeError(n + "must be non-object");
							for (var r in n) n.hasOwnProperty(r) && (e[r] = n[r]);
						}
					}
					return e;
				}, n.shrinkBuf = function(e, t) {
					return e.length === t ? e : e.subarray ? e.subarray(0, t) : (e.length = t, e);
				};
				var i = {
					arraySet: function(e, t, n, r, i) {
						if (t.subarray && e.subarray) e.set(t.subarray(n, n + r), i);
						else for (var a = 0; a < r; a++) e[i + a] = t[n + a];
					},
					flattenChunks: function(e) {
						var t, n, r, i, a, o;
						for (t = r = 0, n = e.length; t < n; t++) r += e[t].length;
						for (o = new Uint8Array(r), t = i = 0, n = e.length; t < n; t++) a = e[t], o.set(a, i), i += a.length;
						return o;
					}
				}, a = {
					arraySet: function(e, t, n, r, i) {
						for (var a = 0; a < r; a++) e[i + a] = t[n + a];
					},
					flattenChunks: function(e) {
						return [].concat.apply([], e);
					}
				};
				n.setTyped = function(e) {
					e ? (n.Buf8 = Uint8Array, n.Buf16 = Uint16Array, n.Buf32 = Int32Array, n.assign(n, i)) : (n.Buf8 = Array, n.Buf16 = Array, n.Buf32 = Array, n.assign(n, a));
				}, n.setTyped(r);
			}, {}],
			42: [function(e, t, n) {
				var r = e("./common"), i = !0, a = !0;
				try {
					String.fromCharCode.apply(null, [0]);
				} catch {
					i = !1;
				}
				try {
					String.fromCharCode.apply(null, new Uint8Array(1));
				} catch {
					a = !1;
				}
				for (var o = new r.Buf8(256), s = 0; s < 256; s++) o[s] = 252 <= s ? 6 : 248 <= s ? 5 : 240 <= s ? 4 : 224 <= s ? 3 : 192 <= s ? 2 : 1;
				function c(e, t) {
					if (t < 65537 && (e.subarray && a || !e.subarray && i)) return String.fromCharCode.apply(null, r.shrinkBuf(e, t));
					for (var n = "", o = 0; o < t; o++) n += String.fromCharCode(e[o]);
					return n;
				}
				o[254] = o[254] = 1, n.string2buf = function(e) {
					var t, n, i, a, o, s = e.length, c = 0;
					for (a = 0; a < s; a++) (64512 & (n = e.charCodeAt(a))) == 55296 && a + 1 < s && (64512 & (i = e.charCodeAt(a + 1))) == 56320 && (n = 65536 + (n - 55296 << 10) + (i - 56320), a++), c += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
					for (t = new r.Buf8(c), a = o = 0; o < c; a++) (64512 & (n = e.charCodeAt(a))) == 55296 && a + 1 < s && (64512 & (i = e.charCodeAt(a + 1))) == 56320 && (n = 65536 + (n - 55296 << 10) + (i - 56320), a++), n < 128 ? t[o++] = n : (n < 2048 ? t[o++] = 192 | n >>> 6 : (n < 65536 ? t[o++] = 224 | n >>> 12 : (t[o++] = 240 | n >>> 18, t[o++] = 128 | n >>> 12 & 63), t[o++] = 128 | n >>> 6 & 63), t[o++] = 128 | 63 & n);
					return t;
				}, n.buf2binstring = function(e) {
					return c(e, e.length);
				}, n.binstring2buf = function(e) {
					for (var t = new r.Buf8(e.length), n = 0, i = t.length; n < i; n++) t[n] = e.charCodeAt(n);
					return t;
				}, n.buf2string = function(e, t) {
					var n, r, i, a, s = t || e.length, l = Array(2 * s);
					for (n = r = 0; n < s;) if ((i = e[n++]) < 128) l[r++] = i;
					else if (4 < (a = o[i])) l[r++] = 65533, n += a - 1;
					else {
						for (i &= a === 2 ? 31 : a === 3 ? 15 : 7; 1 < a && n < s;) i = i << 6 | 63 & e[n++], a--;
						1 < a ? l[r++] = 65533 : i < 65536 ? l[r++] = i : (i -= 65536, l[r++] = 55296 | i >> 10 & 1023, l[r++] = 56320 | 1023 & i);
					}
					return c(l, r);
				}, n.utf8border = function(e, t) {
					var n;
					for ((t = t || e.length) > e.length && (t = e.length), n = t - 1; 0 <= n && (192 & e[n]) == 128;) n--;
					return n < 0 || n === 0 ? t : n + o[e[n]] > t ? n : t;
				};
			}, { "./common": 41 }],
			43: [function(e, t, n) {
				t.exports = function(e, t, n, r) {
					for (var i = 65535 & e | 0, a = e >>> 16 & 65535 | 0, o = 0; n !== 0;) {
						for (n -= o = 2e3 < n ? 2e3 : n; a = a + (i = i + t[r++] | 0) | 0, --o;);
						i %= 65521, a %= 65521;
					}
					return i | a << 16 | 0;
				};
			}, {}],
			44: [function(e, t, n) {
				t.exports = {
					Z_NO_FLUSH: 0,
					Z_PARTIAL_FLUSH: 1,
					Z_SYNC_FLUSH: 2,
					Z_FULL_FLUSH: 3,
					Z_FINISH: 4,
					Z_BLOCK: 5,
					Z_TREES: 6,
					Z_OK: 0,
					Z_STREAM_END: 1,
					Z_NEED_DICT: 2,
					Z_ERRNO: -1,
					Z_STREAM_ERROR: -2,
					Z_DATA_ERROR: -3,
					Z_BUF_ERROR: -5,
					Z_NO_COMPRESSION: 0,
					Z_BEST_SPEED: 1,
					Z_BEST_COMPRESSION: 9,
					Z_DEFAULT_COMPRESSION: -1,
					Z_FILTERED: 1,
					Z_HUFFMAN_ONLY: 2,
					Z_RLE: 3,
					Z_FIXED: 4,
					Z_DEFAULT_STRATEGY: 0,
					Z_BINARY: 0,
					Z_TEXT: 1,
					Z_UNKNOWN: 2,
					Z_DEFLATED: 8
				};
			}, {}],
			45: [function(e, t, n) {
				var r = function() {
					for (var e, t = [], n = 0; n < 256; n++) {
						e = n;
						for (var r = 0; r < 8; r++) e = 1 & e ? 3988292384 ^ e >>> 1 : e >>> 1;
						t[n] = e;
					}
					return t;
				}();
				t.exports = function(e, t, n, i) {
					var a = r, o = i + n;
					e ^= -1;
					for (var s = i; s < o; s++) e = e >>> 8 ^ a[255 & (e ^ t[s])];
					return -1 ^ e;
				};
			}, {}],
			46: [function(e, t, n) {
				var r, i = e("../utils/common"), a = e("./trees"), o = e("./adler32"), s = e("./crc32"), c = e("./messages"), l = 0, u = 4, d = 0, f = -2, p = -1, m = 4, h = 2, g = 8, _ = 9, v = 286, y = 30, b = 19, x = 2 * v + 1, S = 15, C = 3, w = 258, T = w + C + 1, E = 42, D = 113, O = 1, k = 2, A = 3, j = 4;
				function M(e, t) {
					return e.msg = c[t], t;
				}
				function ee(e) {
					return (e << 1) - (4 < e ? 9 : 0);
				}
				function te(e) {
					for (var t = e.length; 0 <= --t;) e[t] = 0;
				}
				function N(e) {
					var t = e.state, n = t.pending;
					n > e.avail_out && (n = e.avail_out), n !== 0 && (i.arraySet(e.output, t.pending_buf, t.pending_out, n, e.next_out), e.next_out += n, t.pending_out += n, e.total_out += n, e.avail_out -= n, t.pending -= n, t.pending === 0 && (t.pending_out = 0));
				}
				function P(e, t) {
					a._tr_flush_block(e, 0 <= e.block_start ? e.block_start : -1, e.strstart - e.block_start, t), e.block_start = e.strstart, N(e.strm);
				}
				function F(e, t) {
					e.pending_buf[e.pending++] = t;
				}
				function I(e, t) {
					e.pending_buf[e.pending++] = t >>> 8 & 255, e.pending_buf[e.pending++] = 255 & t;
				}
				function L(e, t) {
					var n, r, i = e.max_chain_length, a = e.strstart, o = e.prev_length, s = e.nice_match, c = e.strstart > e.w_size - T ? e.strstart - (e.w_size - T) : 0, l = e.window, u = e.w_mask, d = e.prev, f = e.strstart + w, p = l[a + o - 1], m = l[a + o];
					e.prev_length >= e.good_match && (i >>= 2), s > e.lookahead && (s = e.lookahead);
					do
						if (l[(n = t) + o] === m && l[n + o - 1] === p && l[n] === l[a] && l[++n] === l[a + 1]) {
							a += 2, n++;
							do							;
while (l[++a] === l[++n] && l[++a] === l[++n] && l[++a] === l[++n] && l[++a] === l[++n] && l[++a] === l[++n] && l[++a] === l[++n] && l[++a] === l[++n] && l[++a] === l[++n] && a < f);
							if (r = w - (f - a), a = f - w, o < r) {
								if (e.match_start = t, s <= (o = r)) break;
								p = l[a + o - 1], m = l[a + o];
							}
						}
					while ((t = d[t & u]) > c && --i != 0);
					return o <= e.lookahead ? o : e.lookahead;
				}
				function R(e) {
					var t, n, r, a, c, l, u, d, f, p, m = e.w_size;
					do {
						if (a = e.window_size - e.lookahead - e.strstart, e.strstart >= m + (m - T)) {
							for (i.arraySet(e.window, e.window, m, m, 0), e.match_start -= m, e.strstart -= m, e.block_start -= m, t = n = e.hash_size; r = e.head[--t], e.head[t] = m <= r ? r - m : 0, --n;);
							for (t = n = m; r = e.prev[--t], e.prev[t] = m <= r ? r - m : 0, --n;);
							a += m;
						}
						if (e.strm.avail_in === 0) break;
						if (l = e.strm, u = e.window, d = e.strstart + e.lookahead, f = a, p = void 0, p = l.avail_in, f < p && (p = f), n = p === 0 ? 0 : (l.avail_in -= p, i.arraySet(u, l.input, l.next_in, p, d), l.state.wrap === 1 ? l.adler = o(l.adler, u, p, d) : l.state.wrap === 2 && (l.adler = s(l.adler, u, p, d)), l.next_in += p, l.total_in += p, p), e.lookahead += n, e.lookahead + e.insert >= C) for (c = e.strstart - e.insert, e.ins_h = e.window[c], e.ins_h = (e.ins_h << e.hash_shift ^ e.window[c + 1]) & e.hash_mask; e.insert && (e.ins_h = (e.ins_h << e.hash_shift ^ e.window[c + C - 1]) & e.hash_mask, e.prev[c & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = c, c++, e.insert--, !(e.lookahead + e.insert < C)););
					} while (e.lookahead < T && e.strm.avail_in !== 0);
				}
				function z(e, t) {
					for (var n, r;;) {
						if (e.lookahead < T) {
							if (R(e), e.lookahead < T && t === l) return O;
							if (e.lookahead === 0) break;
						}
						if (n = 0, e.lookahead >= C && (e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + C - 1]) & e.hash_mask, n = e.prev[e.strstart & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = e.strstart), n !== 0 && e.strstart - n <= e.w_size - T && (e.match_length = L(e, n)), e.match_length >= C) if (r = a._tr_tally(e, e.strstart - e.match_start, e.match_length - C), e.lookahead -= e.match_length, e.match_length <= e.max_lazy_match && e.lookahead >= C) {
							for (e.match_length--; e.strstart++, e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + C - 1]) & e.hash_mask, n = e.prev[e.strstart & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = e.strstart, --e.match_length != 0;);
							e.strstart++;
						} else e.strstart += e.match_length, e.match_length = 0, e.ins_h = e.window[e.strstart], e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + 1]) & e.hash_mask;
						else r = a._tr_tally(e, 0, e.window[e.strstart]), e.lookahead--, e.strstart++;
						if (r && (P(e, !1), e.strm.avail_out === 0)) return O;
					}
					return e.insert = e.strstart < C - 1 ? e.strstart : C - 1, t === u ? (P(e, !0), e.strm.avail_out === 0 ? A : j) : e.last_lit && (P(e, !1), e.strm.avail_out === 0) ? O : k;
				}
				function ne(e, t) {
					for (var n, r, i;;) {
						if (e.lookahead < T) {
							if (R(e), e.lookahead < T && t === l) return O;
							if (e.lookahead === 0) break;
						}
						if (n = 0, e.lookahead >= C && (e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + C - 1]) & e.hash_mask, n = e.prev[e.strstart & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = e.strstart), e.prev_length = e.match_length, e.prev_match = e.match_start, e.match_length = C - 1, n !== 0 && e.prev_length < e.max_lazy_match && e.strstart - n <= e.w_size - T && (e.match_length = L(e, n), e.match_length <= 5 && (e.strategy === 1 || e.match_length === C && 4096 < e.strstart - e.match_start) && (e.match_length = C - 1)), e.prev_length >= C && e.match_length <= e.prev_length) {
							for (i = e.strstart + e.lookahead - C, r = a._tr_tally(e, e.strstart - 1 - e.prev_match, e.prev_length - C), e.lookahead -= e.prev_length - 1, e.prev_length -= 2; ++e.strstart <= i && (e.ins_h = (e.ins_h << e.hash_shift ^ e.window[e.strstart + C - 1]) & e.hash_mask, n = e.prev[e.strstart & e.w_mask] = e.head[e.ins_h], e.head[e.ins_h] = e.strstart), --e.prev_length != 0;);
							if (e.match_available = 0, e.match_length = C - 1, e.strstart++, r && (P(e, !1), e.strm.avail_out === 0)) return O;
						} else if (e.match_available) {
							if ((r = a._tr_tally(e, 0, e.window[e.strstart - 1])) && P(e, !1), e.strstart++, e.lookahead--, e.strm.avail_out === 0) return O;
						} else e.match_available = 1, e.strstart++, e.lookahead--;
					}
					return e.match_available && (r = a._tr_tally(e, 0, e.window[e.strstart - 1]), e.match_available = 0), e.insert = e.strstart < C - 1 ? e.strstart : C - 1, t === u ? (P(e, !0), e.strm.avail_out === 0 ? A : j) : e.last_lit && (P(e, !1), e.strm.avail_out === 0) ? O : k;
				}
				function B(e, t, n, r, i) {
					this.good_length = e, this.max_lazy = t, this.nice_length = n, this.max_chain = r, this.func = i;
				}
				function re() {
					this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = g, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new i.Buf16(2 * x), this.dyn_dtree = new i.Buf16(2 * (2 * y + 1)), this.bl_tree = new i.Buf16(2 * (2 * b + 1)), te(this.dyn_ltree), te(this.dyn_dtree), te(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new i.Buf16(S + 1), this.heap = new i.Buf16(2 * v + 1), te(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new i.Buf16(2 * v + 1), te(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
				}
				function ie(e) {
					var t;
					return e && e.state ? (e.total_in = e.total_out = 0, e.data_type = h, (t = e.state).pending = 0, t.pending_out = 0, t.wrap < 0 && (t.wrap = -t.wrap), t.status = t.wrap ? E : D, e.adler = t.wrap === 2 ? 0 : 1, t.last_flush = l, a._tr_init(t), d) : M(e, f);
				}
				function ae(e) {
					var t = ie(e);
					return t === d && function(e) {
						e.window_size = 2 * e.w_size, te(e.head), e.max_lazy_match = r[e.level].max_lazy, e.good_match = r[e.level].good_length, e.nice_match = r[e.level].nice_length, e.max_chain_length = r[e.level].max_chain, e.strstart = 0, e.block_start = 0, e.lookahead = 0, e.insert = 0, e.match_length = e.prev_length = C - 1, e.match_available = 0, e.ins_h = 0;
					}(e.state), t;
				}
				function oe(e, t, n, r, a, o) {
					if (!e) return f;
					var s = 1;
					if (t === p && (t = 6), r < 0 ? (s = 0, r = -r) : 15 < r && (s = 2, r -= 16), a < 1 || _ < a || n !== g || r < 8 || 15 < r || t < 0 || 9 < t || o < 0 || m < o) return M(e, f);
					r === 8 && (r = 9);
					var c = new re();
					return (e.state = c).strm = e, c.wrap = s, c.gzhead = null, c.w_bits = r, c.w_size = 1 << c.w_bits, c.w_mask = c.w_size - 1, c.hash_bits = a + 7, c.hash_size = 1 << c.hash_bits, c.hash_mask = c.hash_size - 1, c.hash_shift = ~~((c.hash_bits + C - 1) / C), c.window = new i.Buf8(2 * c.w_size), c.head = new i.Buf16(c.hash_size), c.prev = new i.Buf16(c.w_size), c.lit_bufsize = 1 << a + 6, c.pending_buf_size = 4 * c.lit_bufsize, c.pending_buf = new i.Buf8(c.pending_buf_size), c.d_buf = 1 * c.lit_bufsize, c.l_buf = 3 * c.lit_bufsize, c.level = t, c.strategy = o, c.method = n, ae(e);
				}
				r = [
					new B(0, 0, 0, 0, function(e, t) {
						var n = 65535;
						for (n > e.pending_buf_size - 5 && (n = e.pending_buf_size - 5);;) {
							if (e.lookahead <= 1) {
								if (R(e), e.lookahead === 0 && t === l) return O;
								if (e.lookahead === 0) break;
							}
							e.strstart += e.lookahead, e.lookahead = 0;
							var r = e.block_start + n;
							if ((e.strstart === 0 || e.strstart >= r) && (e.lookahead = e.strstart - r, e.strstart = r, P(e, !1), e.strm.avail_out === 0) || e.strstart - e.block_start >= e.w_size - T && (P(e, !1), e.strm.avail_out === 0)) return O;
						}
						return e.insert = 0, t === u ? (P(e, !0), e.strm.avail_out === 0 ? A : j) : (e.strstart > e.block_start && (P(e, !1), e.strm.avail_out), O);
					}),
					new B(4, 4, 8, 4, z),
					new B(4, 5, 16, 8, z),
					new B(4, 6, 32, 32, z),
					new B(4, 4, 16, 16, ne),
					new B(8, 16, 32, 32, ne),
					new B(8, 16, 128, 128, ne),
					new B(8, 32, 128, 256, ne),
					new B(32, 128, 258, 1024, ne),
					new B(32, 258, 258, 4096, ne)
				], n.deflateInit = function(e, t) {
					return oe(e, t, g, 15, 8, 0);
				}, n.deflateInit2 = oe, n.deflateReset = ae, n.deflateResetKeep = ie, n.deflateSetHeader = function(e, t) {
					return e && e.state && e.state.wrap === 2 ? (e.state.gzhead = t, d) : f;
				}, n.deflate = function(e, t) {
					var n, i, o, c;
					if (!e || !e.state || 5 < t || t < 0) return e ? M(e, f) : f;
					if (i = e.state, !e.output || !e.input && e.avail_in !== 0 || i.status === 666 && t !== u) return M(e, e.avail_out === 0 ? -5 : f);
					if (i.strm = e, n = i.last_flush, i.last_flush = t, i.status === E) if (i.wrap === 2) e.adler = 0, F(i, 31), F(i, 139), F(i, 8), i.gzhead ? (F(i, +!!i.gzhead.text + (i.gzhead.hcrc ? 2 : 0) + (i.gzhead.extra ? 4 : 0) + (i.gzhead.name ? 8 : 0) + (i.gzhead.comment ? 16 : 0)), F(i, 255 & i.gzhead.time), F(i, i.gzhead.time >> 8 & 255), F(i, i.gzhead.time >> 16 & 255), F(i, i.gzhead.time >> 24 & 255), F(i, i.level === 9 ? 2 : 2 <= i.strategy || i.level < 2 ? 4 : 0), F(i, 255 & i.gzhead.os), i.gzhead.extra && i.gzhead.extra.length && (F(i, 255 & i.gzhead.extra.length), F(i, i.gzhead.extra.length >> 8 & 255)), i.gzhead.hcrc && (e.adler = s(e.adler, i.pending_buf, i.pending, 0)), i.gzindex = 0, i.status = 69) : (F(i, 0), F(i, 0), F(i, 0), F(i, 0), F(i, 0), F(i, i.level === 9 ? 2 : 2 <= i.strategy || i.level < 2 ? 4 : 0), F(i, 3), i.status = D);
					else {
						var p = g + (i.w_bits - 8 << 4) << 8;
						p |= (2 <= i.strategy || i.level < 2 ? 0 : i.level < 6 ? 1 : i.level === 6 ? 2 : 3) << 6, i.strstart !== 0 && (p |= 32), p += 31 - p % 31, i.status = D, I(i, p), i.strstart !== 0 && (I(i, e.adler >>> 16), I(i, 65535 & e.adler)), e.adler = 1;
					}
					if (i.status === 69) if (i.gzhead.extra) {
						for (o = i.pending; i.gzindex < (65535 & i.gzhead.extra.length) && (i.pending !== i.pending_buf_size || (i.gzhead.hcrc && i.pending > o && (e.adler = s(e.adler, i.pending_buf, i.pending - o, o)), N(e), o = i.pending, i.pending !== i.pending_buf_size));) F(i, 255 & i.gzhead.extra[i.gzindex]), i.gzindex++;
						i.gzhead.hcrc && i.pending > o && (e.adler = s(e.adler, i.pending_buf, i.pending - o, o)), i.gzindex === i.gzhead.extra.length && (i.gzindex = 0, i.status = 73);
					} else i.status = 73;
					if (i.status === 73) if (i.gzhead.name) {
						o = i.pending;
						do {
							if (i.pending === i.pending_buf_size && (i.gzhead.hcrc && i.pending > o && (e.adler = s(e.adler, i.pending_buf, i.pending - o, o)), N(e), o = i.pending, i.pending === i.pending_buf_size)) {
								c = 1;
								break;
							}
							c = i.gzindex < i.gzhead.name.length ? 255 & i.gzhead.name.charCodeAt(i.gzindex++) : 0, F(i, c);
						} while (c !== 0);
						i.gzhead.hcrc && i.pending > o && (e.adler = s(e.adler, i.pending_buf, i.pending - o, o)), c === 0 && (i.gzindex = 0, i.status = 91);
					} else i.status = 91;
					if (i.status === 91) if (i.gzhead.comment) {
						o = i.pending;
						do {
							if (i.pending === i.pending_buf_size && (i.gzhead.hcrc && i.pending > o && (e.adler = s(e.adler, i.pending_buf, i.pending - o, o)), N(e), o = i.pending, i.pending === i.pending_buf_size)) {
								c = 1;
								break;
							}
							c = i.gzindex < i.gzhead.comment.length ? 255 & i.gzhead.comment.charCodeAt(i.gzindex++) : 0, F(i, c);
						} while (c !== 0);
						i.gzhead.hcrc && i.pending > o && (e.adler = s(e.adler, i.pending_buf, i.pending - o, o)), c === 0 && (i.status = 103);
					} else i.status = 103;
					if (i.status === 103 && (i.gzhead.hcrc ? (i.pending + 2 > i.pending_buf_size && N(e), i.pending + 2 <= i.pending_buf_size && (F(i, 255 & e.adler), F(i, e.adler >> 8 & 255), e.adler = 0, i.status = D)) : i.status = D), i.pending !== 0) {
						if (N(e), e.avail_out === 0) return i.last_flush = -1, d;
					} else if (e.avail_in === 0 && ee(t) <= ee(n) && t !== u) return M(e, -5);
					if (i.status === 666 && e.avail_in !== 0) return M(e, -5);
					if (e.avail_in !== 0 || i.lookahead !== 0 || t !== l && i.status !== 666) {
						var m = i.strategy === 2 ? function(e, t) {
							for (var n;;) {
								if (e.lookahead === 0 && (R(e), e.lookahead === 0)) {
									if (t === l) return O;
									break;
								}
								if (e.match_length = 0, n = a._tr_tally(e, 0, e.window[e.strstart]), e.lookahead--, e.strstart++, n && (P(e, !1), e.strm.avail_out === 0)) return O;
							}
							return e.insert = 0, t === u ? (P(e, !0), e.strm.avail_out === 0 ? A : j) : e.last_lit && (P(e, !1), e.strm.avail_out === 0) ? O : k;
						}(i, t) : i.strategy === 3 ? function(e, t) {
							for (var n, r, i, o, s = e.window;;) {
								if (e.lookahead <= w) {
									if (R(e), e.lookahead <= w && t === l) return O;
									if (e.lookahead === 0) break;
								}
								if (e.match_length = 0, e.lookahead >= C && 0 < e.strstart && (r = s[i = e.strstart - 1]) === s[++i] && r === s[++i] && r === s[++i]) {
									o = e.strstart + w;
									do									;
while (r === s[++i] && r === s[++i] && r === s[++i] && r === s[++i] && r === s[++i] && r === s[++i] && r === s[++i] && r === s[++i] && i < o);
									e.match_length = w - (o - i), e.match_length > e.lookahead && (e.match_length = e.lookahead);
								}
								if (e.match_length >= C ? (n = a._tr_tally(e, 1, e.match_length - C), e.lookahead -= e.match_length, e.strstart += e.match_length, e.match_length = 0) : (n = a._tr_tally(e, 0, e.window[e.strstart]), e.lookahead--, e.strstart++), n && (P(e, !1), e.strm.avail_out === 0)) return O;
							}
							return e.insert = 0, t === u ? (P(e, !0), e.strm.avail_out === 0 ? A : j) : e.last_lit && (P(e, !1), e.strm.avail_out === 0) ? O : k;
						}(i, t) : r[i.level].func(i, t);
						if (m !== A && m !== j || (i.status = 666), m === O || m === A) return e.avail_out === 0 && (i.last_flush = -1), d;
						if (m === k && (t === 1 ? a._tr_align(i) : t !== 5 && (a._tr_stored_block(i, 0, 0, !1), t === 3 && (te(i.head), i.lookahead === 0 && (i.strstart = 0, i.block_start = 0, i.insert = 0))), N(e), e.avail_out === 0)) return i.last_flush = -1, d;
					}
					return t === u ? i.wrap <= 0 ? 1 : (i.wrap === 2 ? (F(i, 255 & e.adler), F(i, e.adler >> 8 & 255), F(i, e.adler >> 16 & 255), F(i, e.adler >> 24 & 255), F(i, 255 & e.total_in), F(i, e.total_in >> 8 & 255), F(i, e.total_in >> 16 & 255), F(i, e.total_in >> 24 & 255)) : (I(i, e.adler >>> 16), I(i, 65535 & e.adler)), N(e), 0 < i.wrap && (i.wrap = -i.wrap), i.pending === 0 ? 1 : d) : d;
				}, n.deflateEnd = function(e) {
					var t;
					return e && e.state ? (t = e.state.status) !== E && t !== 69 && t !== 73 && t !== 91 && t !== 103 && t !== D && t !== 666 ? M(e, f) : (e.state = null, t === D ? M(e, -3) : d) : f;
				}, n.deflateSetDictionary = function(e, t) {
					var n, r, a, s, c, l, u, p, m = t.length;
					if (!e || !e.state || (s = (n = e.state).wrap) === 2 || s === 1 && n.status !== E || n.lookahead) return f;
					for (s === 1 && (e.adler = o(e.adler, t, m, 0)), n.wrap = 0, m >= n.w_size && (s === 0 && (te(n.head), n.strstart = 0, n.block_start = 0, n.insert = 0), p = new i.Buf8(n.w_size), i.arraySet(p, t, m - n.w_size, n.w_size, 0), t = p, m = n.w_size), c = e.avail_in, l = e.next_in, u = e.input, e.avail_in = m, e.next_in = 0, e.input = t, R(n); n.lookahead >= C;) {
						for (r = n.strstart, a = n.lookahead - (C - 1); n.ins_h = (n.ins_h << n.hash_shift ^ n.window[r + C - 1]) & n.hash_mask, n.prev[r & n.w_mask] = n.head[n.ins_h], n.head[n.ins_h] = r, r++, --a;);
						n.strstart = r, n.lookahead = C - 1, R(n);
					}
					return n.strstart += n.lookahead, n.block_start = n.strstart, n.insert = n.lookahead, n.lookahead = 0, n.match_length = n.prev_length = C - 1, n.match_available = 0, e.next_in = l, e.input = u, e.avail_in = c, n.wrap = s, d;
				}, n.deflateInfo = "pako deflate (from Nodeca project)";
			}, {
				"../utils/common": 41,
				"./adler32": 43,
				"./crc32": 45,
				"./messages": 51,
				"./trees": 52
			}],
			47: [function(e, t, n) {
				t.exports = function() {
					this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = !1;
				};
			}, {}],
			48: [function(e, t, n) {
				t.exports = function(e, t) {
					var n = e.state, r = e.next_in, i, a, o, s, c, l, u, d, f, p, m, h, g, _, v, y, b, x, S, C, w, T = e.input, E;
					i = r + (e.avail_in - 5), a = e.next_out, E = e.output, o = a - (t - e.avail_out), s = a + (e.avail_out - 257), c = n.dmax, l = n.wsize, u = n.whave, d = n.wnext, f = n.window, p = n.hold, m = n.bits, h = n.lencode, g = n.distcode, _ = (1 << n.lenbits) - 1, v = (1 << n.distbits) - 1;
					e: do {
						m < 15 && (p += T[r++] << m, m += 8, p += T[r++] << m, m += 8), y = h[p & _];
						t: for (;;) {
							if (p >>>= b = y >>> 24, m -= b, (b = y >>> 16 & 255) == 0) E[a++] = 65535 & y;
							else {
								if (!(16 & b)) {
									if (!(64 & b)) {
										y = h[(65535 & y) + (p & (1 << b) - 1)];
										continue t;
									}
									if (32 & b) {
										n.mode = 12;
										break e;
									}
									e.msg = "invalid literal/length code", n.mode = 30;
									break e;
								}
								x = 65535 & y, (b &= 15) && (m < b && (p += T[r++] << m, m += 8), x += p & (1 << b) - 1, p >>>= b, m -= b), m < 15 && (p += T[r++] << m, m += 8, p += T[r++] << m, m += 8), y = g[p & v];
								r: for (;;) {
									if (p >>>= b = y >>> 24, m -= b, !(16 & (b = y >>> 16 & 255))) {
										if (!(64 & b)) {
											y = g[(65535 & y) + (p & (1 << b) - 1)];
											continue r;
										}
										e.msg = "invalid distance code", n.mode = 30;
										break e;
									}
									if (S = 65535 & y, m < (b &= 15) && (p += T[r++] << m, (m += 8) < b && (p += T[r++] << m, m += 8)), c < (S += p & (1 << b) - 1)) {
										e.msg = "invalid distance too far back", n.mode = 30;
										break e;
									}
									if (p >>>= b, m -= b, (b = a - o) < S) {
										if (u < (b = S - b) && n.sane) {
											e.msg = "invalid distance too far back", n.mode = 30;
											break e;
										}
										if (w = f, (C = 0) === d) {
											if (C += l - b, b < x) {
												for (x -= b; E[a++] = f[C++], --b;);
												C = a - S, w = E;
											}
										} else if (d < b) {
											if (C += l + d - b, (b -= d) < x) {
												for (x -= b; E[a++] = f[C++], --b;);
												if (C = 0, d < x) {
													for (x -= b = d; E[a++] = f[C++], --b;);
													C = a - S, w = E;
												}
											}
										} else if (C += d - b, b < x) {
											for (x -= b; E[a++] = f[C++], --b;);
											C = a - S, w = E;
										}
										for (; 2 < x;) E[a++] = w[C++], E[a++] = w[C++], E[a++] = w[C++], x -= 3;
										x && (E[a++] = w[C++], 1 < x && (E[a++] = w[C++]));
									} else {
										for (C = a - S; E[a++] = E[C++], E[a++] = E[C++], E[a++] = E[C++], 2 < (x -= 3););
										x && (E[a++] = E[C++], 1 < x && (E[a++] = E[C++]));
									}
									break;
								}
							}
							break;
						}
					} while (r < i && a < s);
					r -= x = m >> 3, p &= (1 << (m -= x << 3)) - 1, e.next_in = r, e.next_out = a, e.avail_in = r < i ? i - r + 5 : 5 - (r - i), e.avail_out = a < s ? s - a + 257 : 257 - (a - s), n.hold = p, n.bits = m;
				};
			}, {}],
			49: [function(e, t, n) {
				var r = e("../utils/common"), i = e("./adler32"), a = e("./crc32"), o = e("./inffast"), s = e("./inftrees"), c = 1, l = 2, u = 0, d = -2, f = 1, p = 852, m = 592;
				function h(e) {
					return (e >>> 24 & 255) + (e >>> 8 & 65280) + ((65280 & e) << 8) + ((255 & e) << 24);
				}
				function g() {
					this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new r.Buf16(320), this.work = new r.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
				}
				function _(e) {
					var t;
					return e && e.state ? (t = e.state, e.total_in = e.total_out = t.total = 0, e.msg = "", t.wrap && (e.adler = 1 & t.wrap), t.mode = f, t.last = 0, t.havedict = 0, t.dmax = 32768, t.head = null, t.hold = 0, t.bits = 0, t.lencode = t.lendyn = new r.Buf32(p), t.distcode = t.distdyn = new r.Buf32(m), t.sane = 1, t.back = -1, u) : d;
				}
				function v(e) {
					var t;
					return e && e.state ? ((t = e.state).wsize = 0, t.whave = 0, t.wnext = 0, _(e)) : d;
				}
				function y(e, t) {
					var n, r;
					return e && e.state ? (r = e.state, t < 0 ? (n = 0, t = -t) : (n = 1 + (t >> 4), t < 48 && (t &= 15)), t && (t < 8 || 15 < t) ? d : (r.window !== null && r.wbits !== t && (r.window = null), r.wrap = n, r.wbits = t, v(e))) : d;
				}
				function b(e, t) {
					var n, r;
					return e ? (r = new g(), (e.state = r).window = null, (n = y(e, t)) !== u && (e.state = null), n) : d;
				}
				var x, S, C = !0;
				function w(e) {
					if (C) {
						var t;
						for (x = new r.Buf32(512), S = new r.Buf32(32), t = 0; t < 144;) e.lens[t++] = 8;
						for (; t < 256;) e.lens[t++] = 9;
						for (; t < 280;) e.lens[t++] = 7;
						for (; t < 288;) e.lens[t++] = 8;
						for (s(c, e.lens, 0, 288, x, 0, e.work, { bits: 9 }), t = 0; t < 32;) e.lens[t++] = 5;
						s(l, e.lens, 0, 32, S, 0, e.work, { bits: 5 }), C = !1;
					}
					e.lencode = x, e.lenbits = 9, e.distcode = S, e.distbits = 5;
				}
				function T(e, t, n, i) {
					var a, o = e.state;
					return o.window === null && (o.wsize = 1 << o.wbits, o.wnext = 0, o.whave = 0, o.window = new r.Buf8(o.wsize)), i >= o.wsize ? (r.arraySet(o.window, t, n - o.wsize, o.wsize, 0), o.wnext = 0, o.whave = o.wsize) : (i < (a = o.wsize - o.wnext) && (a = i), r.arraySet(o.window, t, n - i, a, o.wnext), (i -= a) ? (r.arraySet(o.window, t, n - i, i, 0), o.wnext = i, o.whave = o.wsize) : (o.wnext += a, o.wnext === o.wsize && (o.wnext = 0), o.whave < o.wsize && (o.whave += a))), 0;
				}
				n.inflateReset = v, n.inflateReset2 = y, n.inflateResetKeep = _, n.inflateInit = function(e) {
					return b(e, 15);
				}, n.inflateInit2 = b, n.inflate = function(e, t) {
					var n, p, m, g, _, v, y, b, x, S, C, E, D, O, k, A, j, M, ee, te, N, P, F, I, L = 0, R = new r.Buf8(4), z = [
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
					];
					if (!e || !e.state || !e.output || !e.input && e.avail_in !== 0) return d;
					(n = e.state).mode === 12 && (n.mode = 13), _ = e.next_out, m = e.output, y = e.avail_out, g = e.next_in, p = e.input, v = e.avail_in, b = n.hold, x = n.bits, S = v, C = y, P = u;
					e: for (;;) switch (n.mode) {
						case f:
							if (n.wrap === 0) {
								n.mode = 13;
								break;
							}
							for (; x < 16;) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							if (2 & n.wrap && b === 35615) {
								R[n.check = 0] = 255 & b, R[1] = b >>> 8 & 255, n.check = a(n.check, R, 2, 0), x = b = 0, n.mode = 2;
								break;
							}
							if (n.flags = 0, n.head && (n.head.done = !1), !(1 & n.wrap) || (((255 & b) << 8) + (b >> 8)) % 31) {
								e.msg = "incorrect header check", n.mode = 30;
								break;
							}
							if ((15 & b) != 8) {
								e.msg = "unknown compression method", n.mode = 30;
								break;
							}
							if (x -= 4, N = 8 + (15 & (b >>>= 4)), n.wbits === 0) n.wbits = N;
							else if (N > n.wbits) {
								e.msg = "invalid window size", n.mode = 30;
								break;
							}
							n.dmax = 1 << N, e.adler = n.check = 1, n.mode = 512 & b ? 10 : 12, x = b = 0;
							break;
						case 2:
							for (; x < 16;) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							if (n.flags = b, (255 & n.flags) != 8) {
								e.msg = "unknown compression method", n.mode = 30;
								break;
							}
							if (57344 & n.flags) {
								e.msg = "unknown header flags set", n.mode = 30;
								break;
							}
							n.head && (n.head.text = b >> 8 & 1), 512 & n.flags && (R[0] = 255 & b, R[1] = b >>> 8 & 255, n.check = a(n.check, R, 2, 0)), x = b = 0, n.mode = 3;
						case 3:
							for (; x < 32;) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							n.head && (n.head.time = b), 512 & n.flags && (R[0] = 255 & b, R[1] = b >>> 8 & 255, R[2] = b >>> 16 & 255, R[3] = b >>> 24 & 255, n.check = a(n.check, R, 4, 0)), x = b = 0, n.mode = 4;
						case 4:
							for (; x < 16;) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							n.head && (n.head.xflags = 255 & b, n.head.os = b >> 8), 512 & n.flags && (R[0] = 255 & b, R[1] = b >>> 8 & 255, n.check = a(n.check, R, 2, 0)), x = b = 0, n.mode = 5;
						case 5:
							if (1024 & n.flags) {
								for (; x < 16;) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								n.length = b, n.head && (n.head.extra_len = b), 512 & n.flags && (R[0] = 255 & b, R[1] = b >>> 8 & 255, n.check = a(n.check, R, 2, 0)), x = b = 0;
							} else n.head && (n.head.extra = null);
							n.mode = 6;
						case 6:
							if (1024 & n.flags && (v < (E = n.length) && (E = v), E && (n.head && (N = n.head.extra_len - n.length, n.head.extra || (n.head.extra = Array(n.head.extra_len)), r.arraySet(n.head.extra, p, g, E, N)), 512 & n.flags && (n.check = a(n.check, p, E, g)), v -= E, g += E, n.length -= E), n.length)) break e;
							n.length = 0, n.mode = 7;
						case 7:
							if (2048 & n.flags) {
								if (v === 0) break e;
								for (E = 0; N = p[g + E++], n.head && N && n.length < 65536 && (n.head.name += String.fromCharCode(N)), N && E < v;);
								if (512 & n.flags && (n.check = a(n.check, p, E, g)), v -= E, g += E, N) break e;
							} else n.head && (n.head.name = null);
							n.length = 0, n.mode = 8;
						case 8:
							if (4096 & n.flags) {
								if (v === 0) break e;
								for (E = 0; N = p[g + E++], n.head && N && n.length < 65536 && (n.head.comment += String.fromCharCode(N)), N && E < v;);
								if (512 & n.flags && (n.check = a(n.check, p, E, g)), v -= E, g += E, N) break e;
							} else n.head && (n.head.comment = null);
							n.mode = 9;
						case 9:
							if (512 & n.flags) {
								for (; x < 16;) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								if (b !== (65535 & n.check)) {
									e.msg = "header crc mismatch", n.mode = 30;
									break;
								}
								x = b = 0;
							}
							n.head && (n.head.hcrc = n.flags >> 9 & 1, n.head.done = !0), e.adler = n.check = 0, n.mode = 12;
							break;
						case 10:
							for (; x < 32;) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							e.adler = n.check = h(b), x = b = 0, n.mode = 11;
						case 11:
							if (n.havedict === 0) return e.next_out = _, e.avail_out = y, e.next_in = g, e.avail_in = v, n.hold = b, n.bits = x, 2;
							e.adler = n.check = 1, n.mode = 12;
						case 12: if (t === 5 || t === 6) break e;
						case 13:
							if (n.last) {
								b >>>= 7 & x, x -= 7 & x, n.mode = 27;
								break;
							}
							for (; x < 3;) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							switch (n.last = 1 & b, --x, 3 & (b >>>= 1)) {
								case 0:
									n.mode = 14;
									break;
								case 1:
									if (w(n), n.mode = 20, t !== 6) break;
									b >>>= 2, x -= 2;
									break e;
								case 2:
									n.mode = 17;
									break;
								case 3: e.msg = "invalid block type", n.mode = 30;
							}
							b >>>= 2, x -= 2;
							break;
						case 14:
							for (b >>>= 7 & x, x -= 7 & x; x < 32;) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							if ((65535 & b) != (b >>> 16 ^ 65535)) {
								e.msg = "invalid stored block lengths", n.mode = 30;
								break;
							}
							if (n.length = 65535 & b, x = b = 0, n.mode = 15, t === 6) break e;
						case 15: n.mode = 16;
						case 16:
							if (E = n.length) {
								if (v < E && (E = v), y < E && (E = y), E === 0) break e;
								r.arraySet(m, p, g, E, _), v -= E, g += E, y -= E, _ += E, n.length -= E;
								break;
							}
							n.mode = 12;
							break;
						case 17:
							for (; x < 14;) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							if (n.nlen = 257 + (31 & b), b >>>= 5, x -= 5, n.ndist = 1 + (31 & b), b >>>= 5, x -= 5, n.ncode = 4 + (15 & b), b >>>= 4, x -= 4, 286 < n.nlen || 30 < n.ndist) {
								e.msg = "too many length or distance symbols", n.mode = 30;
								break;
							}
							n.have = 0, n.mode = 18;
						case 18:
							for (; n.have < n.ncode;) {
								for (; x < 3;) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								n.lens[z[n.have++]] = 7 & b, b >>>= 3, x -= 3;
							}
							for (; n.have < 19;) n.lens[z[n.have++]] = 0;
							if (n.lencode = n.lendyn, n.lenbits = 7, F = { bits: n.lenbits }, P = s(0, n.lens, 0, 19, n.lencode, 0, n.work, F), n.lenbits = F.bits, P) {
								e.msg = "invalid code lengths set", n.mode = 30;
								break;
							}
							n.have = 0, n.mode = 19;
						case 19:
							for (; n.have < n.nlen + n.ndist;) {
								for (; A = (L = n.lencode[b & (1 << n.lenbits) - 1]) >>> 16 & 255, j = 65535 & L, !((k = L >>> 24) <= x);) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								if (j < 16) b >>>= k, x -= k, n.lens[n.have++] = j;
								else {
									if (j === 16) {
										for (I = k + 2; x < I;) {
											if (v === 0) break e;
											v--, b += p[g++] << x, x += 8;
										}
										if (b >>>= k, x -= k, n.have === 0) {
											e.msg = "invalid bit length repeat", n.mode = 30;
											break;
										}
										N = n.lens[n.have - 1], E = 3 + (3 & b), b >>>= 2, x -= 2;
									} else if (j === 17) {
										for (I = k + 3; x < I;) {
											if (v === 0) break e;
											v--, b += p[g++] << x, x += 8;
										}
										x -= k, N = 0, E = 3 + (7 & (b >>>= k)), b >>>= 3, x -= 3;
									} else {
										for (I = k + 7; x < I;) {
											if (v === 0) break e;
											v--, b += p[g++] << x, x += 8;
										}
										x -= k, N = 0, E = 11 + (127 & (b >>>= k)), b >>>= 7, x -= 7;
									}
									if (n.have + E > n.nlen + n.ndist) {
										e.msg = "invalid bit length repeat", n.mode = 30;
										break;
									}
									for (; E--;) n.lens[n.have++] = N;
								}
							}
							if (n.mode === 30) break;
							if (n.lens[256] === 0) {
								e.msg = "invalid code -- missing end-of-block", n.mode = 30;
								break;
							}
							if (n.lenbits = 9, F = { bits: n.lenbits }, P = s(c, n.lens, 0, n.nlen, n.lencode, 0, n.work, F), n.lenbits = F.bits, P) {
								e.msg = "invalid literal/lengths set", n.mode = 30;
								break;
							}
							if (n.distbits = 6, n.distcode = n.distdyn, F = { bits: n.distbits }, P = s(l, n.lens, n.nlen, n.ndist, n.distcode, 0, n.work, F), n.distbits = F.bits, P) {
								e.msg = "invalid distances set", n.mode = 30;
								break;
							}
							if (n.mode = 20, t === 6) break e;
						case 20: n.mode = 21;
						case 21:
							if (6 <= v && 258 <= y) {
								e.next_out = _, e.avail_out = y, e.next_in = g, e.avail_in = v, n.hold = b, n.bits = x, o(e, C), _ = e.next_out, m = e.output, y = e.avail_out, g = e.next_in, p = e.input, v = e.avail_in, b = n.hold, x = n.bits, n.mode === 12 && (n.back = -1);
								break;
							}
							for (n.back = 0; A = (L = n.lencode[b & (1 << n.lenbits) - 1]) >>> 16 & 255, j = 65535 & L, !((k = L >>> 24) <= x);) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							if (A && !(240 & A)) {
								for (M = k, ee = A, te = j; A = (L = n.lencode[te + ((b & (1 << M + ee) - 1) >> M)]) >>> 16 & 255, j = 65535 & L, !(M + (k = L >>> 24) <= x);) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								b >>>= M, x -= M, n.back += M;
							}
							if (b >>>= k, x -= k, n.back += k, n.length = j, A === 0) {
								n.mode = 26;
								break;
							}
							if (32 & A) {
								n.back = -1, n.mode = 12;
								break;
							}
							if (64 & A) {
								e.msg = "invalid literal/length code", n.mode = 30;
								break;
							}
							n.extra = 15 & A, n.mode = 22;
						case 22:
							if (n.extra) {
								for (I = n.extra; x < I;) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								n.length += b & (1 << n.extra) - 1, b >>>= n.extra, x -= n.extra, n.back += n.extra;
							}
							n.was = n.length, n.mode = 23;
						case 23:
							for (; A = (L = n.distcode[b & (1 << n.distbits) - 1]) >>> 16 & 255, j = 65535 & L, !((k = L >>> 24) <= x);) {
								if (v === 0) break e;
								v--, b += p[g++] << x, x += 8;
							}
							if (!(240 & A)) {
								for (M = k, ee = A, te = j; A = (L = n.distcode[te + ((b & (1 << M + ee) - 1) >> M)]) >>> 16 & 255, j = 65535 & L, !(M + (k = L >>> 24) <= x);) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								b >>>= M, x -= M, n.back += M;
							}
							if (b >>>= k, x -= k, n.back += k, 64 & A) {
								e.msg = "invalid distance code", n.mode = 30;
								break;
							}
							n.offset = j, n.extra = 15 & A, n.mode = 24;
						case 24:
							if (n.extra) {
								for (I = n.extra; x < I;) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								n.offset += b & (1 << n.extra) - 1, b >>>= n.extra, x -= n.extra, n.back += n.extra;
							}
							if (n.offset > n.dmax) {
								e.msg = "invalid distance too far back", n.mode = 30;
								break;
							}
							n.mode = 25;
						case 25:
							if (y === 0) break e;
							if (E = C - y, n.offset > E) {
								if ((E = n.offset - E) > n.whave && n.sane) {
									e.msg = "invalid distance too far back", n.mode = 30;
									break;
								}
								D = E > n.wnext ? (E -= n.wnext, n.wsize - E) : n.wnext - E, E > n.length && (E = n.length), O = n.window;
							} else O = m, D = _ - n.offset, E = n.length;
							for (y < E && (E = y), y -= E, n.length -= E; m[_++] = O[D++], --E;);
							n.length === 0 && (n.mode = 21);
							break;
						case 26:
							if (y === 0) break e;
							m[_++] = n.length, y--, n.mode = 21;
							break;
						case 27:
							if (n.wrap) {
								for (; x < 32;) {
									if (v === 0) break e;
									v--, b |= p[g++] << x, x += 8;
								}
								if (C -= y, e.total_out += C, n.total += C, C && (e.adler = n.check = n.flags ? a(n.check, m, C, _ - C) : i(n.check, m, C, _ - C)), C = y, (n.flags ? b : h(b)) !== n.check) {
									e.msg = "incorrect data check", n.mode = 30;
									break;
								}
								x = b = 0;
							}
							n.mode = 28;
						case 28:
							if (n.wrap && n.flags) {
								for (; x < 32;) {
									if (v === 0) break e;
									v--, b += p[g++] << x, x += 8;
								}
								if (b !== (4294967295 & n.total)) {
									e.msg = "incorrect length check", n.mode = 30;
									break;
								}
								x = b = 0;
							}
							n.mode = 29;
						case 29:
							P = 1;
							break e;
						case 30:
							P = -3;
							break e;
						case 31: return -4;
						case 32:
						default: return d;
					}
					return e.next_out = _, e.avail_out = y, e.next_in = g, e.avail_in = v, n.hold = b, n.bits = x, (n.wsize || C !== e.avail_out && n.mode < 30 && (n.mode < 27 || t !== 4)) && T(e, e.output, e.next_out, C - e.avail_out) ? (n.mode = 31, -4) : (S -= e.avail_in, C -= e.avail_out, e.total_in += S, e.total_out += C, n.total += C, n.wrap && C && (e.adler = n.check = n.flags ? a(n.check, m, C, e.next_out - C) : i(n.check, m, C, e.next_out - C)), e.data_type = n.bits + (n.last ? 64 : 0) + (n.mode === 12 ? 128 : 0) + (n.mode === 20 || n.mode === 15 ? 256 : 0), (S == 0 && C === 0 || t === 4) && P === u && (P = -5), P);
				}, n.inflateEnd = function(e) {
					if (!e || !e.state) return d;
					var t = e.state;
					return t.window && (t.window = null), e.state = null, u;
				}, n.inflateGetHeader = function(e, t) {
					var n;
					return e && e.state && 2 & (n = e.state).wrap ? ((n.head = t).done = !1, u) : d;
				}, n.inflateSetDictionary = function(e, t) {
					var n, r = t.length;
					return e && e.state ? (n = e.state).wrap !== 0 && n.mode !== 11 ? d : n.mode === 11 && i(1, t, r, 0) !== n.check ? -3 : T(e, t, r, r) ? (n.mode = 31, -4) : (n.havedict = 1, u) : d;
				}, n.inflateInfo = "pako inflate (from Nodeca project)";
			}, {
				"../utils/common": 41,
				"./adler32": 43,
				"./crc32": 45,
				"./inffast": 48,
				"./inftrees": 50
			}],
			50: [function(e, t, n) {
				var r = e("../utils/common"), i = [
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
					258,
					0,
					0
				], a = [
					16,
					16,
					16,
					16,
					16,
					16,
					16,
					16,
					17,
					17,
					17,
					17,
					18,
					18,
					18,
					18,
					19,
					19,
					19,
					19,
					20,
					20,
					20,
					20,
					21,
					21,
					21,
					21,
					16,
					72,
					78
				], o = [
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
					24577,
					0,
					0
				], s = [
					16,
					16,
					16,
					16,
					17,
					17,
					18,
					18,
					19,
					19,
					20,
					20,
					21,
					21,
					22,
					22,
					23,
					23,
					24,
					24,
					25,
					25,
					26,
					26,
					27,
					27,
					28,
					28,
					29,
					29,
					64,
					64
				];
				t.exports = function(e, t, n, c, l, u, d, f) {
					var p, m, h, g, _, v, y, b, x, S = f.bits, C = 0, w = 0, T = 0, E = 0, D = 0, O = 0, k = 0, A = 0, j = 0, M = 0, ee = null, te = 0, N = new r.Buf16(16), P = new r.Buf16(16), F = null, I = 0;
					for (C = 0; C <= 15; C++) N[C] = 0;
					for (w = 0; w < c; w++) N[t[n + w]]++;
					for (D = S, E = 15; 1 <= E && N[E] === 0; E--);
					if (E < D && (D = E), E === 0) return l[u++] = 20971520, l[u++] = 20971520, f.bits = 1, 0;
					for (T = 1; T < E && N[T] === 0; T++);
					for (D < T && (D = T), C = A = 1; C <= 15; C++) if (A <<= 1, (A -= N[C]) < 0) return -1;
					if (0 < A && (e === 0 || E !== 1)) return -1;
					for (P[1] = 0, C = 1; C < 15; C++) P[C + 1] = P[C] + N[C];
					for (w = 0; w < c; w++) t[n + w] !== 0 && (d[P[t[n + w]]++] = w);
					if (v = e === 0 ? (ee = F = d, 19) : e === 1 ? (ee = i, te -= 257, F = a, I -= 257, 256) : (ee = o, F = s, -1), C = T, _ = u, k = w = M = 0, h = -1, g = (j = 1 << (O = D)) - 1, e === 1 && 852 < j || e === 2 && 592 < j) return 1;
					for (;;) {
						for (y = C - k, x = d[w] < v ? (b = 0, d[w]) : d[w] > v ? (b = F[I + d[w]], ee[te + d[w]]) : (b = 96, 0), p = 1 << C - k, T = m = 1 << O; l[_ + (M >> k) + (m -= p)] = y << 24 | b << 16 | x | 0, m !== 0;);
						for (p = 1 << C - 1; M & p;) p >>= 1;
						if (p === 0 ? M = 0 : (M &= p - 1, M += p), w++, --N[C] == 0) {
							if (C === E) break;
							C = t[n + d[w]];
						}
						if (D < C && (M & g) !== h) {
							for (k === 0 && (k = D), _ += T, A = 1 << (O = C - k); O + k < E && !((A -= N[O + k]) <= 0);) O++, A <<= 1;
							if (j += 1 << O, e === 1 && 852 < j || e === 2 && 592 < j) return 1;
							l[h = M & g] = D << 24 | O << 16 | _ - u | 0;
						}
					}
					return M !== 0 && (l[_ + M] = C - k << 24 | 4194304), f.bits = D, 0;
				};
			}, { "../utils/common": 41 }],
			51: [function(e, t, n) {
				t.exports = {
					2: "need dictionary",
					1: "stream end",
					0: "",
					"-1": "file error",
					"-2": "stream error",
					"-3": "data error",
					"-4": "insufficient memory",
					"-5": "buffer error",
					"-6": "incompatible version"
				};
			}, {}],
			52: [function(e, t, n) {
				var r = e("../utils/common"), i = 0, a = 1;
				function o(e) {
					for (var t = e.length; 0 <= --t;) e[t] = 0;
				}
				var s = 0, c = 29, l = 256, u = l + 1 + c, d = 30, f = 19, p = 2 * u + 1, m = 15, h = 16, g = 7, _ = 256, v = 16, y = 17, b = 18, x = [
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					0,
					1,
					1,
					1,
					1,
					2,
					2,
					2,
					2,
					3,
					3,
					3,
					3,
					4,
					4,
					4,
					4,
					5,
					5,
					5,
					5,
					0
				], S = [
					0,
					0,
					0,
					0,
					1,
					1,
					2,
					2,
					3,
					3,
					4,
					4,
					5,
					5,
					6,
					6,
					7,
					7,
					8,
					8,
					9,
					9,
					10,
					10,
					11,
					11,
					12,
					12,
					13,
					13
				], C = [
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
					2,
					3,
					7
				], w = [
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
				], T = Array(2 * (u + 2));
				o(T);
				var E = Array(2 * d);
				o(E);
				var D = Array(512);
				o(D);
				var O = Array(256);
				o(O);
				var k = Array(c);
				o(k);
				var A, j, M, ee = Array(d);
				function te(e, t, n, r, i) {
					this.static_tree = e, this.extra_bits = t, this.extra_base = n, this.elems = r, this.max_length = i, this.has_stree = e && e.length;
				}
				function N(e, t) {
					this.dyn_tree = e, this.max_code = 0, this.stat_desc = t;
				}
				function P(e) {
					return e < 256 ? D[e] : D[256 + (e >>> 7)];
				}
				function F(e, t) {
					e.pending_buf[e.pending++] = 255 & t, e.pending_buf[e.pending++] = t >>> 8 & 255;
				}
				function I(e, t, n) {
					e.bi_valid > h - n ? (e.bi_buf |= t << e.bi_valid & 65535, F(e, e.bi_buf), e.bi_buf = t >> h - e.bi_valid, e.bi_valid += n - h) : (e.bi_buf |= t << e.bi_valid & 65535, e.bi_valid += n);
				}
				function L(e, t, n) {
					I(e, n[2 * t], n[2 * t + 1]);
				}
				function R(e, t) {
					for (var n = 0; n |= 1 & e, e >>>= 1, n <<= 1, 0 < --t;);
					return n >>> 1;
				}
				function z(e, t, n) {
					var r, i, a = Array(m + 1), o = 0;
					for (r = 1; r <= m; r++) a[r] = o = o + n[r - 1] << 1;
					for (i = 0; i <= t; i++) {
						var s = e[2 * i + 1];
						s !== 0 && (e[2 * i] = R(a[s]++, s));
					}
				}
				function ne(e) {
					var t;
					for (t = 0; t < u; t++) e.dyn_ltree[2 * t] = 0;
					for (t = 0; t < d; t++) e.dyn_dtree[2 * t] = 0;
					for (t = 0; t < f; t++) e.bl_tree[2 * t] = 0;
					e.dyn_ltree[2 * _] = 1, e.opt_len = e.static_len = 0, e.last_lit = e.matches = 0;
				}
				function B(e) {
					8 < e.bi_valid ? F(e, e.bi_buf) : 0 < e.bi_valid && (e.pending_buf[e.pending++] = e.bi_buf), e.bi_buf = 0, e.bi_valid = 0;
				}
				function re(e, t, n, r) {
					var i = 2 * t, a = 2 * n;
					return e[i] < e[a] || e[i] === e[a] && r[t] <= r[n];
				}
				function ie(e, t, n) {
					for (var r = e.heap[n], i = n << 1; i <= e.heap_len && (i < e.heap_len && re(t, e.heap[i + 1], e.heap[i], e.depth) && i++, !re(t, r, e.heap[i], e.depth));) e.heap[n] = e.heap[i], n = i, i <<= 1;
					e.heap[n] = r;
				}
				function ae(e, t, n) {
					var r, i, a, o, s = 0;
					if (e.last_lit !== 0) for (; r = e.pending_buf[e.d_buf + 2 * s] << 8 | e.pending_buf[e.d_buf + 2 * s + 1], i = e.pending_buf[e.l_buf + s], s++, r === 0 ? L(e, i, t) : (L(e, (a = O[i]) + l + 1, t), (o = x[a]) !== 0 && I(e, i -= k[a], o), L(e, a = P(--r), n), (o = S[a]) !== 0 && I(e, r -= ee[a], o)), s < e.last_lit;);
					L(e, _, t);
				}
				function oe(e, t) {
					var n, r, i, a = t.dyn_tree, o = t.stat_desc.static_tree, s = t.stat_desc.has_stree, c = t.stat_desc.elems, l = -1;
					for (e.heap_len = 0, e.heap_max = p, n = 0; n < c; n++) a[2 * n] === 0 ? a[2 * n + 1] = 0 : (e.heap[++e.heap_len] = l = n, e.depth[n] = 0);
					for (; e.heap_len < 2;) a[2 * (i = e.heap[++e.heap_len] = l < 2 ? ++l : 0)] = 1, e.depth[i] = 0, e.opt_len--, s && (e.static_len -= o[2 * i + 1]);
					for (t.max_code = l, n = e.heap_len >> 1; 1 <= n; n--) ie(e, a, n);
					for (i = c; n = e.heap[1], e.heap[1] = e.heap[e.heap_len--], ie(e, a, 1), r = e.heap[1], e.heap[--e.heap_max] = n, e.heap[--e.heap_max] = r, a[2 * i] = a[2 * n] + a[2 * r], e.depth[i] = (e.depth[n] >= e.depth[r] ? e.depth[n] : e.depth[r]) + 1, a[2 * n + 1] = a[2 * r + 1] = i, e.heap[1] = i++, ie(e, a, 1), 2 <= e.heap_len;);
					e.heap[--e.heap_max] = e.heap[1], function(e, t) {
						var n, r, i, a, o, s, c = t.dyn_tree, l = t.max_code, u = t.stat_desc.static_tree, d = t.stat_desc.has_stree, f = t.stat_desc.extra_bits, h = t.stat_desc.extra_base, g = t.stat_desc.max_length, _ = 0;
						for (a = 0; a <= m; a++) e.bl_count[a] = 0;
						for (c[2 * e.heap[e.heap_max] + 1] = 0, n = e.heap_max + 1; n < p; n++) g < (a = c[2 * c[2 * (r = e.heap[n]) + 1] + 1] + 1) && (a = g, _++), c[2 * r + 1] = a, l < r || (e.bl_count[a]++, o = 0, h <= r && (o = f[r - h]), s = c[2 * r], e.opt_len += s * (a + o), d && (e.static_len += s * (u[2 * r + 1] + o)));
						if (_ !== 0) {
							do {
								for (a = g - 1; e.bl_count[a] === 0;) a--;
								e.bl_count[a]--, e.bl_count[a + 1] += 2, e.bl_count[g]--, _ -= 2;
							} while (0 < _);
							for (a = g; a !== 0; a--) for (r = e.bl_count[a]; r !== 0;) l < (i = e.heap[--n]) || (c[2 * i + 1] !== a && (e.opt_len += (a - c[2 * i + 1]) * c[2 * i], c[2 * i + 1] = a), r--);
						}
					}(e, t), z(a, l, e.bl_count);
				}
				function se(e, t, n) {
					var r, i, a = -1, o = t[1], s = 0, c = 7, l = 4;
					for (o === 0 && (c = 138, l = 3), t[2 * (n + 1) + 1] = 65535, r = 0; r <= n; r++) i = o, o = t[2 * (r + 1) + 1], ++s < c && i === o || (s < l ? e.bl_tree[2 * i] += s : i === 0 ? s <= 10 ? e.bl_tree[2 * y]++ : e.bl_tree[2 * b]++ : (i !== a && e.bl_tree[2 * i]++, e.bl_tree[2 * v]++), a = i, l = (s = 0) === o ? (c = 138, 3) : i === o ? (c = 6, 3) : (c = 7, 4));
				}
				function V(e, t, n) {
					var r, i, a = -1, o = t[1], s = 0, c = 7, l = 4;
					for (o === 0 && (c = 138, l = 3), r = 0; r <= n; r++) if (i = o, o = t[2 * (r + 1) + 1], !(++s < c && i === o)) {
						if (s < l) for (; L(e, i, e.bl_tree), --s != 0;);
						else i === 0 ? s <= 10 ? (L(e, y, e.bl_tree), I(e, s - 3, 3)) : (L(e, b, e.bl_tree), I(e, s - 11, 7)) : (i !== a && (L(e, i, e.bl_tree), s--), L(e, v, e.bl_tree), I(e, s - 3, 2));
						a = i, l = (s = 0) === o ? (c = 138, 3) : i === o ? (c = 6, 3) : (c = 7, 4);
					}
				}
				o(ee);
				var ce = !1;
				function le(e, t, n, i) {
					I(e, (s << 1) + +!!i, 3), function(e, t, n, i) {
						B(e), i && (F(e, n), F(e, ~n)), r.arraySet(e.pending_buf, e.window, t, n, e.pending), e.pending += n;
					}(e, t, n, !0);
				}
				n._tr_init = function(e) {
					ce || (function() {
						var e, t, n, r, i, a = Array(m + 1);
						for (r = n = 0; r < c - 1; r++) for (k[r] = n, e = 0; e < 1 << x[r]; e++) O[n++] = r;
						for (O[n - 1] = r, r = i = 0; r < 16; r++) for (ee[r] = i, e = 0; e < 1 << S[r]; e++) D[i++] = r;
						for (i >>= 7; r < d; r++) for (ee[r] = i << 7, e = 0; e < 1 << S[r] - 7; e++) D[256 + i++] = r;
						for (t = 0; t <= m; t++) a[t] = 0;
						for (e = 0; e <= 143;) T[2 * e + 1] = 8, e++, a[8]++;
						for (; e <= 255;) T[2 * e + 1] = 9, e++, a[9]++;
						for (; e <= 279;) T[2 * e + 1] = 7, e++, a[7]++;
						for (; e <= 287;) T[2 * e + 1] = 8, e++, a[8]++;
						for (z(T, u + 1, a), e = 0; e < d; e++) E[2 * e + 1] = 5, E[2 * e] = R(e, 5);
						A = new te(T, x, l + 1, u, m), j = new te(E, S, 0, d, m), M = new te([], C, 0, f, g);
					}(), ce = !0), e.l_desc = new N(e.dyn_ltree, A), e.d_desc = new N(e.dyn_dtree, j), e.bl_desc = new N(e.bl_tree, M), e.bi_buf = 0, e.bi_valid = 0, ne(e);
				}, n._tr_stored_block = le, n._tr_flush_block = function(e, t, n, r) {
					var o, s, c = 0;
					0 < e.level ? (e.strm.data_type === 2 && (e.strm.data_type = function(e) {
						var t, n = 4093624447;
						for (t = 0; t <= 31; t++, n >>>= 1) if (1 & n && e.dyn_ltree[2 * t] !== 0) return i;
						if (e.dyn_ltree[18] !== 0 || e.dyn_ltree[20] !== 0 || e.dyn_ltree[26] !== 0) return a;
						for (t = 32; t < l; t++) if (e.dyn_ltree[2 * t] !== 0) return a;
						return i;
					}(e)), oe(e, e.l_desc), oe(e, e.d_desc), c = function(e) {
						var t;
						for (se(e, e.dyn_ltree, e.l_desc.max_code), se(e, e.dyn_dtree, e.d_desc.max_code), oe(e, e.bl_desc), t = f - 1; 3 <= t && e.bl_tree[2 * w[t] + 1] === 0; t--);
						return e.opt_len += 3 * (t + 1) + 5 + 5 + 4, t;
					}(e), o = e.opt_len + 3 + 7 >>> 3, (s = e.static_len + 3 + 7 >>> 3) <= o && (o = s)) : o = s = n + 5, n + 4 <= o && t !== -1 ? le(e, t, n, r) : e.strategy === 4 || s === o ? (I(e, 2 + +!!r, 3), ae(e, T, E)) : (I(e, 4 + +!!r, 3), function(e, t, n, r) {
						var i;
						for (I(e, t - 257, 5), I(e, n - 1, 5), I(e, r - 4, 4), i = 0; i < r; i++) I(e, e.bl_tree[2 * w[i] + 1], 3);
						V(e, e.dyn_ltree, t - 1), V(e, e.dyn_dtree, n - 1);
					}(e, e.l_desc.max_code + 1, e.d_desc.max_code + 1, c + 1), ae(e, e.dyn_ltree, e.dyn_dtree)), ne(e), r && B(e);
				}, n._tr_tally = function(e, t, n) {
					return e.pending_buf[e.d_buf + 2 * e.last_lit] = t >>> 8 & 255, e.pending_buf[e.d_buf + 2 * e.last_lit + 1] = 255 & t, e.pending_buf[e.l_buf + e.last_lit] = 255 & n, e.last_lit++, t === 0 ? e.dyn_ltree[2 * n]++ : (e.matches++, t--, e.dyn_ltree[2 * (O[n] + l + 1)]++, e.dyn_dtree[2 * P(t)]++), e.last_lit === e.lit_bufsize - 1;
				}, n._tr_align = function(e) {
					I(e, 2, 3), L(e, _, T), function(e) {
						e.bi_valid === 16 ? (F(e, e.bi_buf), e.bi_buf = 0, e.bi_valid = 0) : 8 <= e.bi_valid && (e.pending_buf[e.pending++] = 255 & e.bi_buf, e.bi_buf >>= 8, e.bi_valid -= 8);
					}(e);
				};
			}, { "../utils/common": 41 }],
			53: [function(e, t, n) {
				t.exports = function() {
					this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
				};
			}, {}],
			54: [function(e, t, n) {
				(function(e) {
					(function(e, t) {
						if (!e.setImmediate) {
							var n, r, i, a, o = 1, s = {}, c = !1, l = e.document, u = Object.getPrototypeOf && Object.getPrototypeOf(e);
							u = u && u.setTimeout ? u : e, n = {}.toString.call(e.process) === "[object process]" ? function(e) {
								process.nextTick(function() {
									f(e);
								});
							} : function() {
								if (e.postMessage && !e.importScripts) {
									var t = !0, n = e.onmessage;
									return e.onmessage = function() {
										t = !1;
									}, e.postMessage("", "*"), e.onmessage = n, t;
								}
							}() ? (a = "setImmediate$" + Math.random() + "$", e.addEventListener ? e.addEventListener("message", p, !1) : e.attachEvent("onmessage", p), function(t) {
								e.postMessage(a + t, "*");
							}) : e.MessageChannel ? ((i = new MessageChannel()).port1.onmessage = function(e) {
								f(e.data);
							}, function(e) {
								i.port2.postMessage(e);
							}) : l && "onreadystatechange" in l.createElement("script") ? (r = l.documentElement, function(e) {
								var t = l.createElement("script");
								t.onreadystatechange = function() {
									f(e), t.onreadystatechange = null, r.removeChild(t), t = null;
								}, r.appendChild(t);
							}) : function(e) {
								setTimeout(f, 0, e);
							}, u.setImmediate = function(e) {
								typeof e != "function" && (e = Function("" + e));
								for (var t = Array(arguments.length - 1), r = 0; r < t.length; r++) t[r] = arguments[r + 1];
								return s[o] = {
									callback: e,
									args: t
								}, n(o), o++;
							}, u.clearImmediate = d;
						}
						function d(e) {
							delete s[e];
						}
						function f(e) {
							if (c) setTimeout(f, 0, e);
							else {
								var n = s[e];
								if (n) {
									c = !0;
									try {
										(function(e) {
											var n = e.callback, r = e.args;
											switch (r.length) {
												case 0:
													n();
													break;
												case 1:
													n(r[0]);
													break;
												case 2:
													n(r[0], r[1]);
													break;
												case 3:
													n(r[0], r[1], r[2]);
													break;
												default: n.apply(t, r);
											}
										})(n);
									} finally {
										d(e), c = !1;
									}
								}
							}
						}
						function p(t) {
							t.source === e && typeof t.data == "string" && t.data.indexOf(a) === 0 && f(+t.data.slice(a.length));
						}
					})(typeof self > "u" ? e === void 0 ? this : e : self);
				}).call(this, typeof global < "u" ? global : typeof self < "u" ? self : typeof window < "u" ? window : {});
			}, {}]
		}, {}, [10])(10);
	});
})))(), 1), m;
(function(e) {
	e.OfficeDocument = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", e.FontTable = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable", e.Image = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", e.Numbering = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering", e.Styles = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", e.StylesWithEffects = "http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects", e.Theme = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme", e.Settings = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings", e.WebSettings = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings", e.Hyperlink = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", e.Footnotes = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes", e.Endnotes = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes", e.Footer = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer", e.Header = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header", e.ExtendedProperties = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", e.CoreProperties = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", e.CustomProperties = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/custom-properties", e.Comments = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments", e.CommentsExtended = "http://schemas.microsoft.com/office/2011/relationships/commentsExtended", e.AltChunk = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk";
})(m || (m = {}));
function h(e, t) {
	return t.elements(e).map((e) => ({
		id: t.attr(e, "Id"),
		type: t.attr(e, "Type"),
		target: t.attr(e, "Target"),
		targetMode: t.attr(e, "TargetMode")
	}));
}
function g(e) {
	return e == null ? void 0 : e.replace(/[ .]+/g, "-").replace(/[&]+/g, "and").toLowerCase();
}
function _(e) {
	return /^[^"'].*\s.*[^"']$/.test(e) ? `'${e}'` : e;
}
function v(e) {
	let t = e.lastIndexOf("/") + 1;
	return [t == 0 ? "" : e.substring(0, t), t == 0 ? e : e.substring(t)];
}
function y(e, t) {
	try {
		return new URL(e, "http://docx/" + t).toString().substring(12);
	} catch {
		return `${t}${e}`;
	}
}
function b(e, t) {
	return e.reduce((e, n) => (e[t(n)] = n, e), {});
}
function x(e) {
	return new Promise((t, n) => {
		let r = new FileReader();
		r.onloadend = () => t(r.result), r.onerror = () => n(), r.readAsDataURL(e);
	});
}
function S(e) {
	return e && typeof e == "object" && !Array.isArray(e);
}
function C(e) {
	return typeof e == "string" || e instanceof String;
}
function w(e, ...t) {
	if (!t.length) return e;
	let n = t.shift();
	if (S(e) && S(n)) for (let t in n) if (S(n[t])) {
		var r;
		w((r = e[t]) == null ? e[t] = {} : r, n[t]);
	} else e[t] = n[t];
	return w(e, ...t);
}
function T(e) {
	return Array.isArray(e) ? e : [e];
}
function E(e, t, n) {
	return t > e ? t : n < e ? n : e;
}
var D = { wordml: "http://schemas.openxmlformats.org/wordprocessingml/2006/main" }, O = {
	Dxa: {
		mul: .05,
		unit: "pt"
	},
	Emu: {
		mul: 1 / 12700,
		unit: "pt"
	},
	FontSize: {
		mul: .5,
		unit: "pt"
	},
	Border: {
		mul: .125,
		unit: "pt",
		min: .25,
		max: 12
	},
	Point: {
		mul: 1,
		unit: "pt"
	},
	Percent: {
		mul: .02,
		unit: "%"
	}
};
function k(e, t = O.Dxa) {
	if (e == null || /.+(p[xt]|[%])$/.test(e)) return e;
	var n = parseInt(e) * t.mul;
	return t.min && t.max && (n = E(n, t.min, t.max)), `${n.toFixed(2)}${t.unit}`;
}
function A(e, t = !1) {
	switch (e) {
		case "1": return !0;
		case "0": return !1;
		case "on": return !0;
		case "off": return !1;
		case "true": return !0;
		case "false": return !1;
		default: return t;
	}
}
function j(e, t, n) {
	if (e.namespaceURI != D.wordml) return !1;
	switch (e.localName) {
		case "color":
			t.color = n.attr(e, "val");
			break;
		case "sz":
			t.fontSize = n.lengthAttr(e, "val", O.FontSize);
			break;
		default: return !1;
	}
	return !0;
}
function M(e, t = !1) {
	t && (e = e.replace(/<[?].*[?]>/, "")), e = te(e);
	let n = new DOMParser().parseFromString(e, "application/xml"), r = ee(n);
	if (r) throw Error(r);
	return n;
}
function ee(e) {
	var t;
	return (t = e.getElementsByTagName("parsererror")[0]) == null ? void 0 : t.textContent;
}
function te(e) {
	return e.charCodeAt(0) === 65279 ? e.substring(1) : e;
}
function N(e) {
	return new XMLSerializer().serializeToString(e);
}
var P = class {
	elements(e, t = null) {
		let n = [];
		for (let r = 0, i = e.childNodes.length; r < i; r++) {
			let i = e.childNodes.item(r);
			i.nodeType == Node.ELEMENT_NODE && (t == null || i.localName == t) && n.push(i);
		}
		return n;
	}
	element(e, t) {
		for (let n = 0, r = e.childNodes.length; n < r; n++) {
			let r = e.childNodes.item(n);
			if (r.nodeType == 1 && r.localName == t) return r;
		}
		return null;
	}
	elementAttr(e, t, n) {
		var r = this.element(e, t);
		return r ? this.attr(r, n) : void 0;
	}
	attrs(e) {
		return Array.from(e.attributes);
	}
	attr(e, t) {
		for (let n = 0, r = e.attributes.length; n < r; n++) {
			let r = e.attributes.item(n);
			if (r.localName == t) return r.value;
		}
		return null;
	}
	intAttr(e, t, n = null) {
		var r = this.attr(e, t);
		return r ? parseInt(r) : n;
	}
	hexAttr(e, t, n = null) {
		var r = this.attr(e, t);
		return r ? parseInt(r, 16) : n;
	}
	floatAttr(e, t, n = null) {
		var r = this.attr(e, t);
		return r ? parseFloat(r) : n;
	}
	boolAttr(e, t, n = null) {
		return A(this.attr(e, t), n);
	}
	lengthAttr(e, t, n = O.Dxa) {
		return k(this.attr(e, t), n);
	}
}, F = new P(), I = class {
	constructor(e, t) {
		this._package = e, this.path = t;
	}
	async load() {
		this.rels = await this._package.loadRelationships(this.path);
		let e = await this._package.load(this.path), t = this._package.parseXmlDocument(e);
		this._package.options.keepOrigin && (this._xmlDocument = t), this.parseXml(t.firstElementChild);
	}
	save() {
		this._package.update(this.path, N(this._xmlDocument));
	}
	parseXml(e) {}
}, L = {
	embedRegular: "regular",
	embedBold: "bold",
	embedItalic: "italic",
	embedBoldItalic: "boldItalic"
};
function R(e, t) {
	return t.elements(e).map((e) => z(e, t));
}
function z(e, t) {
	let n = {
		name: t.attr(e, "name"),
		embedFontRefs: []
	};
	for (let r of t.elements(e)) switch (r.localName) {
		case "family":
			n.family = t.attr(r, "val");
			break;
		case "altName":
			n.altName = t.attr(r, "val");
			break;
		case "embedRegular":
		case "embedBold":
		case "embedItalic":
		case "embedBoldItalic":
			n.embedFontRefs.push(ne(r, t));
			break;
	}
	return n;
}
function ne(e, t) {
	return {
		id: t.attr(e, "id"),
		key: t.attr(e, "fontKey"),
		type: L[e.localName]
	};
}
var B = class extends I {
	parseXml(e) {
		this.fonts = R(e, this._package.xmlParser);
	}
}, re = class e {
	constructor(e, t) {
		this._zip = e, this.options = t, this.xmlParser = new P();
	}
	get(e) {
		var t;
		let n = ie(e);
		return (t = this._zip.files[n]) == null ? this._zip.files[n.replace(/\//g, "\\")] : t;
	}
	update(e, t) {
		this._zip.file(e, t);
	}
	static async load(t, n) {
		return new e(await p.default.loadAsync(t), n);
	}
	save(e = "blob") {
		return this._zip.generateAsync({ type: e });
	}
	load(e, t = "string") {
		var n, r;
		return (n = (r = this.get(e)) == null ? void 0 : r.async(t)) == null ? Promise.resolve(null) : n;
	}
	async loadRelationships(e = null) {
		let t = "_rels/.rels";
		if (e != null) {
			let [n, r] = v(e);
			t = `${n}_rels/${r}.rels`;
		}
		let n = await this.load(t);
		return n ? h(this.parseXmlDocument(n).firstElementChild, this.xmlParser) : null;
	}
	parseXmlDocument(e) {
		return M(e, this.options.trimXmlDeclaration);
	}
};
function ie(e) {
	return e.startsWith("/") ? e.substr(1) : e;
}
var ae = class extends I {
	constructor(e, t, n) {
		super(e, t), this._documentParser = n;
	}
	parseXml(e) {
		this.body = this._documentParser.parseDocumentFile(e);
	}
};
function oe(e, t) {
	return {
		type: t.attr(e, "val"),
		color: t.attr(e, "color"),
		size: t.lengthAttr(e, "sz", O.Border),
		offset: t.lengthAttr(e, "space", O.Point),
		frame: t.boolAttr(e, "frame"),
		shadow: t.boolAttr(e, "shadow")
	};
}
function se(e, t) {
	var n = {};
	for (let r of t.elements(e)) switch (r.localName) {
		case "left":
			n.left = oe(r, t);
			break;
		case "top":
			n.top = oe(r, t);
			break;
		case "right":
			n.right = oe(r, t);
			break;
		case "bottom":
			n.bottom = oe(r, t);
			break;
	}
	return n;
}
var V;
(function(e) {
	e.Continuous = "continuous", e.NextPage = "nextPage", e.NextColumn = "nextColumn", e.EvenPage = "evenPage", e.OddPage = "oddPage";
})(V || (V = {}));
function ce(e, t = F) {
	var n = {};
	for (let a of t.elements(e)) switch (a.localName) {
		case "pgSz":
			n.pageSize = {
				width: t.lengthAttr(a, "w"),
				height: t.lengthAttr(a, "h"),
				orientation: t.attr(a, "orient")
			};
			break;
		case "type":
			n.type = t.attr(a, "val");
			break;
		case "pgMar":
			n.pageMargins = {
				left: t.lengthAttr(a, "left"),
				right: t.lengthAttr(a, "right"),
				top: t.lengthAttr(a, "top"),
				bottom: t.lengthAttr(a, "bottom"),
				header: t.lengthAttr(a, "header"),
				footer: t.lengthAttr(a, "footer"),
				gutter: t.lengthAttr(a, "gutter")
			};
			break;
		case "cols":
			n.columns = le(a, t);
			break;
		case "headerReference":
			var r;
			((r = n.headerRefs) == null ? n.headerRefs = [] : r).push(de(a, t));
			break;
		case "footerReference":
			var i;
			((i = n.footerRefs) == null ? n.footerRefs = [] : i).push(de(a, t));
			break;
		case "titlePg":
			n.titlePage = t.boolAttr(a, "val", !0);
			break;
		case "pgBorders":
			n.pageBorders = se(a, t);
			break;
		case "pgNumType":
			n.pageNumber = ue(a, t);
			break;
	}
	return n;
}
function le(e, t) {
	return {
		numberOfColumns: t.intAttr(e, "num"),
		space: t.lengthAttr(e, "space"),
		separator: t.boolAttr(e, "sep"),
		equalWidth: t.boolAttr(e, "equalWidth", !0),
		columns: t.elements(e, "col").map((e) => ({
			width: t.lengthAttr(e, "w"),
			space: t.lengthAttr(e, "space")
		}))
	};
}
function ue(e, t) {
	return {
		chapSep: t.attr(e, "chapSep"),
		chapStyle: t.attr(e, "chapStyle"),
		format: t.attr(e, "fmt"),
		start: t.intAttr(e, "start")
	};
}
function de(e, t) {
	return {
		id: t.attr(e, "id"),
		type: t.attr(e, "type")
	};
}
function fe(e, t) {
	return {
		before: t.lengthAttr(e, "before"),
		after: t.lengthAttr(e, "after"),
		line: t.intAttr(e, "line"),
		lineRule: t.attr(e, "lineRule")
	};
}
function pe(e, t) {
	let n = {};
	for (let r of t.elements(e)) me(r, n, t);
	return n;
}
function me(e, t, n) {
	return !!j(e, t, n);
}
function he(e, t) {
	let n = {};
	for (let r of t.elements(e)) ge(r, n, t);
	return n;
}
function ge(e, t, n) {
	if (e.namespaceURI != D.wordml) return !1;
	if (j(e, t, n)) return !0;
	switch (e.localName) {
		case "tabs":
			t.tabs = _e(e, n);
			break;
		case "sectPr":
			t.sectionProps = ce(e, n);
			break;
		case "numPr":
			t.numbering = ve(e, n);
			break;
		case "spacing": return t.lineSpacing = fe(e, n), !1;
		case "textAlignment": return t.textAlignment = n.attr(e, "val"), !1;
		case "keepLines":
			t.keepLines = n.boolAttr(e, "val", !0);
			break;
		case "keepNext":
			t.keepNext = n.boolAttr(e, "val", !0);
			break;
		case "pageBreakBefore":
			t.pageBreakBefore = n.boolAttr(e, "val", !0);
			break;
		case "outlineLvl":
			t.outlineLevel = n.intAttr(e, "val");
			break;
		case "pStyle":
			t.styleName = n.attr(e, "val");
			break;
		case "rPr":
			t.runProps = pe(e, n);
			break;
		default: return !1;
	}
	return !0;
}
function _e(e, t) {
	return t.elements(e, "tab").map((e) => ({
		position: t.lengthAttr(e, "pos"),
		leader: t.attr(e, "leader"),
		style: t.attr(e, "val")
	}));
}
function ve(e, t) {
	var n = {};
	for (let r of t.elements(e)) switch (r.localName) {
		case "numId":
			n.id = t.attr(r, "val");
			break;
		case "ilvl":
			n.level = t.intAttr(r, "val");
			break;
	}
	return n;
}
function ye(e, t) {
	let n = {
		numberings: [],
		abstractNumberings: [],
		bulletPictures: []
	};
	for (let r of t.elements(e)) switch (r.localName) {
		case "num":
			n.numberings.push(be(r, t));
			break;
		case "abstractNum":
			n.abstractNumberings.push(xe(r, t));
			break;
		case "numPicBullet":
			n.bulletPictures.push(we(r, t));
			break;
	}
	return n;
}
function be(e, t) {
	let n = {
		id: t.attr(e, "numId"),
		overrides: []
	};
	for (let r of t.elements(e)) switch (r.localName) {
		case "abstractNumId":
			n.abstractId = t.attr(r, "val");
			break;
		case "lvlOverride":
			n.overrides.push(Ce(r, t));
			break;
	}
	return n;
}
function xe(e, t) {
	let n = {
		id: t.attr(e, "abstractNumId"),
		levels: []
	};
	for (let r of t.elements(e)) switch (r.localName) {
		case "name":
			n.name = t.attr(r, "val");
			break;
		case "multiLevelType":
			n.multiLevelType = t.attr(r, "val");
			break;
		case "numStyleLink":
			n.numberingStyleLink = t.attr(r, "val");
			break;
		case "styleLink":
			n.styleLink = t.attr(r, "val");
			break;
		case "lvl":
			n.levels.push(Se(r, t));
			break;
	}
	return n;
}
function Se(e, t) {
	let n = { level: t.intAttr(e, "ilvl") };
	for (let r of t.elements(e)) switch (r.localName) {
		case "start":
			n.start = t.attr(r, "val");
			break;
		case "lvlRestart":
			n.restart = t.intAttr(r, "val");
			break;
		case "numFmt":
			n.format = t.attr(r, "val");
			break;
		case "lvlText":
			n.text = t.attr(r, "val");
			break;
		case "lvlJc":
			n.justification = t.attr(r, "val");
			break;
		case "lvlPicBulletId":
			n.bulletPictureId = t.attr(r, "val");
			break;
		case "pStyle":
			n.paragraphStyle = t.attr(r, "val");
			break;
		case "pPr":
			n.paragraphProps = he(r, t);
			break;
		case "rPr":
			n.runProps = pe(r, t);
			break;
	}
	return n;
}
function Ce(e, t) {
	let n = { level: t.intAttr(e, "ilvl") };
	for (let r of t.elements(e)) switch (r.localName) {
		case "startOverride":
			n.start = t.intAttr(r, "val");
			break;
		case "lvl":
			n.numberingLevel = Se(r, t);
			break;
	}
	return n;
}
function we(e, t) {
	var n = t.element(e, "pict"), r = n && t.element(n, "shape"), i = r && t.element(r, "imagedata");
	return i ? {
		id: t.attr(e, "numPicBulletId"),
		referenceId: t.attr(i, "id"),
		style: t.attr(r, "style")
	} : null;
}
var Te = class extends I {
	constructor(e, t, n) {
		super(e, t), this._documentParser = n;
	}
	parseXml(e) {
		Object.assign(this, ye(e, this._package.xmlParser)), this.domNumberings = this._documentParser.parseNumberingFile(e);
	}
}, Ee = class extends I {
	constructor(e, t, n) {
		super(e, t), this._documentParser = n;
	}
	parseXml(e) {
		this.styles = this._documentParser.parseStylesFile(e);
	}
}, H;
(function(e) {
	e.Document = "document", e.Paragraph = "paragraph", e.Run = "run", e.Break = "break", e.NoBreakHyphen = "noBreakHyphen", e.Table = "table", e.Row = "row", e.Cell = "cell", e.Hyperlink = "hyperlink", e.SmartTag = "smartTag", e.Drawing = "drawing", e.Image = "image", e.Text = "text", e.Tab = "tab", e.Symbol = "symbol", e.BookmarkStart = "bookmarkStart", e.BookmarkEnd = "bookmarkEnd", e.Footer = "footer", e.Header = "header", e.FootnoteReference = "footnoteReference", e.EndnoteReference = "endnoteReference", e.Footnote = "footnote", e.Endnote = "endnote", e.SimpleField = "simpleField", e.ComplexField = "complexField", e.Instruction = "instruction", e.VmlPicture = "vmlPicture", e.MmlMath = "mmlMath", e.MmlMathParagraph = "mmlMathParagraph", e.MmlFraction = "mmlFraction", e.MmlFunction = "mmlFunction", e.MmlFunctionName = "mmlFunctionName", e.MmlNumerator = "mmlNumerator", e.MmlDenominator = "mmlDenominator", e.MmlRadical = "mmlRadical", e.MmlBase = "mmlBase", e.MmlDegree = "mmlDegree", e.MmlSuperscript = "mmlSuperscript", e.MmlSubscript = "mmlSubscript", e.MmlPreSubSuper = "mmlPreSubSuper", e.MmlSubArgument = "mmlSubArgument", e.MmlSuperArgument = "mmlSuperArgument", e.MmlNary = "mmlNary", e.MmlDelimiter = "mmlDelimiter", e.MmlRun = "mmlRun", e.MmlEquationArray = "mmlEquationArray", e.MmlLimit = "mmlLimit", e.MmlLimitLower = "mmlLimitLower", e.MmlMatrix = "mmlMatrix", e.MmlMatrixRow = "mmlMatrixRow", e.MmlBox = "mmlBox", e.MmlBar = "mmlBar", e.MmlGroupChar = "mmlGroupChar", e.VmlElement = "vmlElement", e.Inserted = "inserted", e.Deleted = "deleted", e.DeletedText = "deletedText", e.Comment = "comment", e.CommentReference = "commentReference", e.CommentRangeStart = "commentRangeStart", e.CommentRangeEnd = "commentRangeEnd", e.AltChunk = "altChunk";
})(H || (H = {}));
var De = class {
	constructor() {
		this.children = [], this.cssStyle = {};
	}
}, Oe = class extends De {
	constructor() {
		super(...arguments), this.type = H.Header;
	}
}, ke = class extends De {
	constructor() {
		super(...arguments), this.type = H.Footer;
	}
}, Ae = class extends I {
	constructor(e, t, n) {
		super(e, t), this._documentParser = n;
	}
	parseXml(e) {
		this.rootElement = this.createRootElement(), this.rootElement.children = this._documentParser.parseBodyElements(e);
	}
}, je = class extends Ae {
	createRootElement() {
		return new Oe();
	}
}, Me = class extends Ae {
	createRootElement() {
		return new ke();
	}
};
function Ne(e, t) {
	let n = {};
	for (let r of t.elements(e)) switch (r.localName) {
		case "Template":
			n.template = r.textContent;
			break;
		case "Pages":
			n.pages = Pe(r.textContent);
			break;
		case "Words":
			n.words = Pe(r.textContent);
			break;
		case "Characters":
			n.characters = Pe(r.textContent);
			break;
		case "Application":
			n.application = r.textContent;
			break;
		case "Lines":
			n.lines = Pe(r.textContent);
			break;
		case "Paragraphs":
			n.paragraphs = Pe(r.textContent);
			break;
		case "Company":
			n.company = r.textContent;
			break;
		case "AppVersion":
			n.appVersion = r.textContent;
			break;
	}
	return n;
}
function Pe(e) {
	if (e !== void 0) return parseInt(e);
}
var Fe = class extends I {
	parseXml(e) {
		this.props = Ne(e, this._package.xmlParser);
	}
};
function Ie(e, t) {
	let n = {};
	for (let r of t.elements(e)) switch (r.localName) {
		case "title":
			n.title = r.textContent;
			break;
		case "description":
			n.description = r.textContent;
			break;
		case "subject":
			n.subject = r.textContent;
			break;
		case "creator":
			n.creator = r.textContent;
			break;
		case "keywords":
			n.keywords = r.textContent;
			break;
		case "language":
			n.language = r.textContent;
			break;
		case "lastModifiedBy":
			n.lastModifiedBy = r.textContent;
			break;
		case "revision":
			r.textContent && (n.revision = parseInt(r.textContent));
			break;
	}
	return n;
}
var Le = class extends I {
	parseXml(e) {
		this.props = Ie(e, this._package.xmlParser);
	}
}, Re = class {};
function ze(e, t) {
	var n = new Re(), r = t.element(e, "themeElements");
	for (let e of t.elements(r)) switch (e.localName) {
		case "clrScheme":
			n.colorScheme = Be(e, t);
			break;
		case "fontScheme":
			n.fontScheme = Ve(e, t);
			break;
	}
	return n;
}
function Be(e, t) {
	var n = {
		name: t.attr(e, "name"),
		colors: {}
	};
	for (let a of t.elements(e)) {
		var r = t.element(a, "srgbClr"), i = t.element(a, "sysClr");
		r ? n.colors[a.localName] = t.attr(r, "val") : i && (n.colors[a.localName] = t.attr(i, "lastClr"));
	}
	return n;
}
function Ve(e, t) {
	var n = { name: t.attr(e, "name") };
	for (let r of t.elements(e)) switch (r.localName) {
		case "majorFont":
			n.majorFont = He(r, t);
			break;
		case "minorFont":
			n.minorFont = He(r, t);
			break;
	}
	return n;
}
function He(e, t) {
	return {
		latinTypeface: t.elementAttr(e, "latin", "typeface"),
		eaTypeface: t.elementAttr(e, "ea", "typeface"),
		csTypeface: t.elementAttr(e, "cs", "typeface")
	};
}
var Ue = class extends I {
	constructor(e, t) {
		super(e, t);
	}
	parseXml(e) {
		this.theme = ze(e, this._package.xmlParser);
	}
}, We = class {}, Ge = class extends We {
	constructor() {
		super(...arguments), this.type = H.Footnote;
	}
}, Ke = class extends We {
	constructor() {
		super(...arguments), this.type = H.Endnote;
	}
}, qe = class extends I {
	constructor(e, t, n) {
		super(e, t), this._documentParser = n;
	}
}, Je = class extends qe {
	constructor(e, t, n) {
		super(e, t, n);
	}
	parseXml(e) {
		this.notes = this._documentParser.parseNotes(e, "footnote", Ge);
	}
}, Ye = class extends qe {
	constructor(e, t, n) {
		super(e, t, n);
	}
	parseXml(e) {
		this.notes = this._documentParser.parseNotes(e, "endnote", Ke);
	}
};
function Xe(e, t) {
	var n = {};
	for (let r of t.elements(e)) switch (r.localName) {
		case "defaultTabStop":
			n.defaultTabStop = t.lengthAttr(r, "val");
			break;
		case "footnotePr":
			n.footnoteProps = Ze(r, t);
			break;
		case "endnotePr":
			n.endnoteProps = Ze(r, t);
			break;
		case "autoHyphenation":
			n.autoHyphenation = t.boolAttr(r, "val");
			break;
	}
	return n;
}
function Ze(e, t) {
	var n = { defaultNoteIds: [] };
	for (let r of t.elements(e)) switch (r.localName) {
		case "numFmt":
			n.nummeringFormat = t.attr(r, "val");
			break;
		case "footnote":
		case "endnote":
			n.defaultNoteIds.push(t.attr(r, "id"));
			break;
	}
	return n;
}
var Qe = class extends I {
	constructor(e, t) {
		super(e, t);
	}
	parseXml(e) {
		this.settings = Xe(e, this._package.xmlParser);
	}
};
function $e(e, t) {
	return t.elements(e, "property").map((e) => {
		let n = e.firstChild;
		return {
			formatId: t.attr(e, "fmtid"),
			name: t.attr(e, "name"),
			type: n.nodeName,
			value: n.textContent
		};
	});
}
var et = class extends I {
	parseXml(e) {
		this.props = $e(e, this._package.xmlParser);
	}
}, tt = class extends I {
	constructor(e, t, n) {
		super(e, t), this._documentParser = n;
	}
	parseXml(e) {
		this.comments = this._documentParser.parseComments(e), this.commentMap = b(this.comments, (e) => e.id);
	}
}, nt = class extends I {
	constructor(e, t) {
		super(e, t), this.comments = [];
	}
	parseXml(e) {
		let t = this._package.xmlParser;
		for (let n of t.elements(e, "commentEx")) this.comments.push({
			paraId: t.attr(n, "paraId"),
			paraIdParent: t.attr(n, "paraIdParent"),
			done: t.boolAttr(n, "done")
		});
		this.commentMap = b(this.comments, (e) => e.paraId);
	}
}, rt = [
	{
		type: m.OfficeDocument,
		target: "word/document.xml"
	},
	{
		type: m.ExtendedProperties,
		target: "docProps/app.xml"
	},
	{
		type: m.CoreProperties,
		target: "docProps/core.xml"
	},
	{
		type: m.CustomProperties,
		target: "docProps/custom.xml"
	}
], it = class e {
	constructor() {
		this.parts = [], this.partsMap = {};
	}
	static async load(t, n, r) {
		var i = new e();
		return i._options = r, i._parser = n, i._package = await re.load(t, r), i.rels = await i._package.loadRelationships(), await Promise.all(rt.map((e) => {
			var t;
			let n = (t = i.rels.find((t) => t.type === e.type)) == null ? e : t;
			return i.loadRelationshipPart(n.target, n.type);
		})), i;
	}
	save(e = "blob") {
		return this._package.save(e);
	}
	async loadRelationshipPart(e, t) {
		var n;
		if (this.partsMap[e]) return this.partsMap[e];
		if (!this._package.get(e)) return null;
		let r = null;
		switch (t) {
			case m.OfficeDocument:
				this.documentPart = r = new ae(this._package, e, this._parser);
				break;
			case m.FontTable:
				this.fontTablePart = r = new B(this._package, e);
				break;
			case m.Numbering:
				this.numberingPart = r = new Te(this._package, e, this._parser);
				break;
			case m.Styles:
				this.stylesPart = r = new Ee(this._package, e, this._parser);
				break;
			case m.Theme:
				this.themePart = r = new Ue(this._package, e);
				break;
			case m.Footnotes:
				this.footnotesPart = r = new Je(this._package, e, this._parser);
				break;
			case m.Endnotes:
				this.endnotesPart = r = new Ye(this._package, e, this._parser);
				break;
			case m.Footer:
				r = new Me(this._package, e, this._parser);
				break;
			case m.Header:
				r = new je(this._package, e, this._parser);
				break;
			case m.CoreProperties:
				this.corePropsPart = r = new Le(this._package, e);
				break;
			case m.ExtendedProperties:
				this.extendedPropsPart = r = new Fe(this._package, e);
				break;
			case m.CustomProperties:
				r = new et(this._package, e);
				break;
			case m.Settings:
				this.settingsPart = r = new Qe(this._package, e);
				break;
			case m.Comments:
				this.commentsPart = r = new tt(this._package, e, this._parser);
				break;
			case m.CommentsExtended:
				this.commentsExtendedPart = r = new nt(this._package, e);
				break;
		}
		if (r == null) return Promise.resolve(null);
		if (this.partsMap[e] = r, this.parts.push(r), await r.load(), ((n = r.rels) == null ? void 0 : n.length) > 0) {
			let [e] = v(r.path);
			await Promise.all(r.rels.map((t) => this.loadRelationshipPart(y(t.target, e), t.type)));
		}
		return r;
	}
	async loadDocumentImage(e, t) {
		let n = await this.loadResource(t == null ? this.documentPart : t, e, "blob");
		return this.blobToURL(n);
	}
	async loadNumberingImage(e) {
		let t = await this.loadResource(this.numberingPart, e, "blob");
		return this.blobToURL(t);
	}
	async loadFont(e, t) {
		let n = await this.loadResource(this.fontTablePart, e, "uint8array");
		return n && this.blobToURL(new Blob([at(n, t)]));
	}
	async loadAltChunk(e, t) {
		return await this.loadResource(t == null ? this.documentPart : t, e, "string");
	}
	blobToURL(e) {
		return e ? this._options.useBase64URL ? x(e) : URL.createObjectURL(e) : null;
	}
	findPartByRelId(e, t = null) {
		var n, r = ((n = t.rels) == null ? this.rels : n).find((t) => t.id == e);
		let i = t ? v(t.path)[0] : "";
		return r ? this.partsMap[y(r.target, i)] : null;
	}
	getPathById(e, t) {
		let n = e.rels.find((e) => e.id == t), [r] = v(e.path);
		return n ? y(n.target, r) : null;
	}
	loadResource(e, t, n) {
		let r = this.getPathById(e, t);
		return r ? this._package.load(r, n) : Promise.resolve(null);
	}
};
function at(e, t) {
	let n = t.replace(/{|}|-/g, ""), r = Array(16);
	for (let e = 0; e < 16; e++) r[16 - e - 1] = parseInt(n.substring(e * 2, e * 2 + 2), 16);
	for (let t = 0; t < 32; t++) e[t] = e[t] ^ r[t % 16];
	return e;
}
function ot(e, t) {
	return {
		type: H.BookmarkStart,
		id: t.attr(e, "id"),
		name: t.attr(e, "name"),
		colFirst: t.intAttr(e, "colFirst"),
		colLast: t.intAttr(e, "colLast")
	};
}
function st(e, t) {
	return {
		type: H.BookmarkEnd,
		id: t.attr(e, "id")
	};
}
var ct = class extends De {
	constructor() {
		super(...arguments), this.type = H.VmlElement, this.attrs = {};
	}
};
function lt(e, t) {
	var n = new ct();
	switch (e.localName) {
		case "rect":
			n.tagName = "rect", Object.assign(n.attrs, {
				width: "100%",
				height: "100%"
			});
			break;
		case "oval":
			n.tagName = "ellipse", Object.assign(n.attrs, {
				cx: "50%",
				cy: "50%",
				rx: "50%",
				ry: "50%"
			});
			break;
		case "line":
			n.tagName = "line";
			break;
		case "shape":
			n.tagName = "g";
			break;
		case "textbox":
			n.tagName = "foreignObject", Object.assign(n.attrs, {
				width: "100%",
				height: "100%"
			});
			break;
		default: return null;
	}
	for (let t of F.attrs(e)) switch (t.localName) {
		case "style":
			n.cssStyleText = t.value;
			break;
		case "fillcolor":
			n.attrs.fill = t.value;
			break;
		case "from":
			let [e, r] = ft(t.value);
			Object.assign(n.attrs, {
				x1: e,
				y1: r
			});
			break;
		case "to":
			let [i, a] = ft(t.value);
			Object.assign(n.attrs, {
				x2: i,
				y2: a
			});
			break;
	}
	for (let r of F.elements(e)) switch (r.localName) {
		case "stroke":
			Object.assign(n.attrs, ut(r));
			break;
		case "fill":
			Object.assign(n.attrs, dt());
			break;
		case "imagedata":
			n.tagName = "image", Object.assign(n.attrs, {
				width: "100%",
				height: "100%"
			}), n.imageHref = {
				id: F.attr(r, "id"),
				title: F.attr(r, "title")
			};
			break;
		case "txbxContent":
			n.children.push(...t.parseBodyElements(r));
			break;
		default:
			let e = lt(r, t);
			e && n.children.push(e);
			break;
	}
	return n;
}
function ut(e) {
	var t;
	return {
		stroke: F.attr(e, "color"),
		"stroke-width": (t = F.lengthAttr(e, "weight", O.Emu)) == null ? "1px" : t
	};
}
function dt(e) {
	return {};
}
function ft(e) {
	return e.split(",");
}
var pt = class extends De {
	constructor() {
		super(...arguments), this.type = H.Comment;
	}
}, mt = class extends De {
	constructor(e) {
		super(), this.id = e, this.type = H.CommentReference;
	}
}, ht = class extends De {
	constructor(e) {
		super(), this.id = e, this.type = H.CommentRangeStart;
	}
}, gt = class extends De {
	constructor(e) {
		super(), this.id = e, this.type = H.CommentRangeEnd;
	}
}, _t = {
	shd: "inherit",
	color: "black",
	borderColor: "black",
	highlight: "transparent"
}, vt = [], yt = {
	oMath: H.MmlMath,
	oMathPara: H.MmlMathParagraph,
	f: H.MmlFraction,
	func: H.MmlFunction,
	fName: H.MmlFunctionName,
	num: H.MmlNumerator,
	den: H.MmlDenominator,
	rad: H.MmlRadical,
	deg: H.MmlDegree,
	e: H.MmlBase,
	sSup: H.MmlSuperscript,
	sSub: H.MmlSubscript,
	sPre: H.MmlPreSubSuper,
	sup: H.MmlSuperArgument,
	sub: H.MmlSubArgument,
	d: H.MmlDelimiter,
	nary: H.MmlNary,
	eqArr: H.MmlEquationArray,
	lim: H.MmlLimit,
	limLow: H.MmlLimitLower,
	m: H.MmlMatrix,
	mr: H.MmlMatrixRow,
	box: H.MmlBox,
	bar: H.MmlBar,
	groupChr: H.MmlGroupChar
}, bt = class {
	constructor(e) {
		this.options = {
			ignoreWidth: !1,
			debug: !1,
			...e
		};
	}
	parseNotes(e, t, n) {
		var r = [];
		for (let i of F.elements(e, t)) {
			let e = new n();
			e.id = F.attr(i, "id"), e.noteType = F.attr(i, "type"), e.children = this.parseBodyElements(i), r.push(e);
		}
		return r;
	}
	parseComments(e) {
		var t = [];
		for (let n of F.elements(e, "comment")) {
			let e = new pt();
			e.id = F.attr(n, "id"), e.author = F.attr(n, "author"), e.initials = F.attr(n, "initials"), e.date = F.attr(n, "date"), e.children = this.parseBodyElements(n), t.push(e);
		}
		return t;
	}
	parseDocumentFile(e) {
		var t = F.element(e, "body"), n = F.element(e, "background"), r = F.element(t, "sectPr");
		return {
			type: H.Document,
			children: this.parseBodyElements(t),
			props: r ? ce(r, F) : {},
			cssStyle: n ? this.parseBackground(n) : {}
		};
	}
	parseBackground(e) {
		var t = {}, n = St.colorAttr(e, "color");
		return n && (t["background-color"] = n), t;
	}
	parseBodyElements(e) {
		var t = [];
		for (let n of F.elements(e)) switch (n.localName) {
			case "p":
				t.push(this.parseParagraph(n));
				break;
			case "altChunk":
				t.push(this.parseAltChunk(n));
				break;
			case "tbl":
				t.push(this.parseTable(n));
				break;
			case "sdt":
				t.push(...this.parseSdt(n, (e) => this.parseBodyElements(e)));
				break;
		}
		return t;
	}
	parseStylesFile(e) {
		var t = [];
		for (let n of F.elements(e)) switch (n.localName) {
			case "style":
				t.push(this.parseStyle(n));
				break;
			case "docDefaults":
				t.push(this.parseDefaultStyles(n));
				break;
		}
		return t;
	}
	parseDefaultStyles(e) {
		var t = {
			id: null,
			name: null,
			target: null,
			basedOn: null,
			styles: []
		};
		for (let i of F.elements(e)) switch (i.localName) {
			case "rPrDefault":
				var n = F.element(i, "rPr");
				n && t.styles.push({
					target: "span",
					values: this.parseDefaultProperties(n, {})
				});
				break;
			case "pPrDefault":
				var r = F.element(i, "pPr");
				r && t.styles.push({
					target: "p",
					values: this.parseDefaultProperties(r, {})
				});
				break;
		}
		return t;
	}
	parseStyle(e) {
		var t = {
			id: F.attr(e, "styleId"),
			isDefault: F.boolAttr(e, "default"),
			name: null,
			target: null,
			basedOn: null,
			styles: [],
			linked: null
		};
		switch (F.attr(e, "type")) {
			case "paragraph":
				t.target = "p";
				break;
			case "table":
				t.target = "table";
				break;
			case "character":
				t.target = "span";
				break;
		}
		for (let n of F.elements(e)) switch (n.localName) {
			case "basedOn":
				t.basedOn = F.attr(n, "val");
				break;
			case "name":
				t.name = F.attr(n, "val");
				break;
			case "link":
				t.linked = F.attr(n, "val");
				break;
			case "next":
				t.next = F.attr(n, "val");
				break;
			case "aliases":
				t.aliases = F.attr(n, "val").split(",");
				break;
			case "pPr":
				t.styles.push({
					target: "p",
					values: this.parseDefaultProperties(n, {})
				}), t.paragraphProps = he(n, F);
				break;
			case "rPr":
				t.styles.push({
					target: "span",
					values: this.parseDefaultProperties(n, {})
				}), t.runProps = pe(n, F);
				break;
			case "tblPr":
			case "tcPr":
				t.styles.push({
					target: "td",
					values: this.parseDefaultProperties(n, {})
				});
				break;
			case "tblStylePr":
				for (let e of this.parseTableStyle(n)) t.styles.push(e);
				break;
			case "rsid":
			case "qFormat":
			case "hidden":
			case "semiHidden":
			case "unhideWhenUsed":
			case "autoRedefine":
			case "uiPriority": break;
			default: this.options.debug && console.warn(`DOCX: Unknown style element: ${n.localName}`);
		}
		return t;
	}
	parseTableStyle(e) {
		var t = [], n = F.attr(e, "type"), r = "", i = "";
		switch (n) {
			case "firstRow":
				i = ".first-row", r = "tr.first-row td";
				break;
			case "lastRow":
				i = ".last-row", r = "tr.last-row td";
				break;
			case "firstCol":
				i = ".first-col", r = "td.first-col";
				break;
			case "lastCol":
				i = ".last-col", r = "td.last-col";
				break;
			case "band1Vert":
				i = ":not(.no-vband)", r = "td.odd-col";
				break;
			case "band2Vert":
				i = ":not(.no-vband)", r = "td.even-col";
				break;
			case "band1Horz":
				i = ":not(.no-hband)", r = "tr.odd-row";
				break;
			case "band2Horz":
				i = ":not(.no-hband)", r = "tr.even-row";
				break;
			default: return [];
		}
		for (let n of F.elements(e)) switch (n.localName) {
			case "pPr":
				t.push({
					target: `${r} p`,
					mod: i,
					values: this.parseDefaultProperties(n, {})
				});
				break;
			case "rPr":
				t.push({
					target: `${r} span`,
					mod: i,
					values: this.parseDefaultProperties(n, {})
				});
				break;
			case "tblPr":
			case "tcPr":
				t.push({
					target: r,
					mod: i,
					values: this.parseDefaultProperties(n, {})
				});
				break;
		}
		return t;
	}
	parseNumberingFile(e) {
		var t = [], n = {}, r = [];
		for (let o of F.elements(e)) switch (o.localName) {
			case "abstractNum":
				this.parseAbstractNumbering(o, r).forEach((e) => t.push(e));
				break;
			case "numPicBullet":
				r.push(this.parseNumberingPicBullet(o));
				break;
			case "num":
				var i = F.attr(o, "numId"), a = F.elementAttr(o, "abstractNumId", "val");
				n[a] = i;
				break;
		}
		return t.forEach((e) => e.id = n[e.id]), t;
	}
	parseNumberingPicBullet(e) {
		var t = F.element(e, "pict"), n = t && F.element(t, "shape"), r = n && F.element(n, "imagedata");
		return r ? {
			id: F.intAttr(e, "numPicBulletId"),
			src: F.attr(r, "id"),
			style: F.attr(n, "style")
		} : null;
	}
	parseAbstractNumbering(e, t) {
		var n = [], r = F.attr(e, "abstractNumId");
		for (let i of F.elements(e)) switch (i.localName) {
			case "lvl":
				n.push(this.parseNumberingLevel(r, i, t));
				break;
		}
		return n;
	}
	parseNumberingLevel(e, t, n) {
		var r = {
			id: e,
			level: F.intAttr(t, "ilvl"),
			start: 1,
			pStyleName: void 0,
			pStyle: {},
			rStyle: {},
			suff: "tab"
		};
		for (let e of F.elements(t)) switch (e.localName) {
			case "start":
				r.start = F.intAttr(e, "val");
				break;
			case "pPr":
				this.parseDefaultProperties(e, r.pStyle);
				break;
			case "rPr":
				this.parseDefaultProperties(e, r.rStyle);
				break;
			case "lvlPicBulletId":
				var i = F.intAttr(e, "val");
				r.bullet = n.find((e) => (e == null ? void 0 : e.id) == i);
				break;
			case "lvlText":
				r.levelText = F.attr(e, "val");
				break;
			case "pStyle":
				r.pStyleName = F.attr(e, "val");
				break;
			case "numFmt":
				r.format = F.attr(e, "val");
				break;
			case "suff":
				r.suff = F.attr(e, "val");
				break;
		}
		return r;
	}
	parseSdt(e, t) {
		let n = F.element(e, "sdtContent");
		return n ? t(n) : [];
	}
	parseInserted(e, t) {
		var n, r;
		return {
			type: H.Inserted,
			children: (n = (r = t(e)) == null ? void 0 : r.children) == null ? [] : n
		};
	}
	parseDeleted(e, t) {
		var n, r;
		return {
			type: H.Deleted,
			children: (n = (r = t(e)) == null ? void 0 : r.children) == null ? [] : n
		};
	}
	parseAltChunk(e) {
		return {
			type: H.AltChunk,
			children: [],
			id: F.attr(e, "id")
		};
	}
	parseParagraph(e) {
		var t = {
			type: H.Paragraph,
			children: []
		};
		for (let n of F.elements(e)) switch (n.localName) {
			case "pPr":
				this.parseParagraphProperties(n, t);
				break;
			case "r":
				t.children.push(this.parseRun(n, t));
				break;
			case "hyperlink":
				t.children.push(this.parseHyperlink(n, t));
				break;
			case "smartTag":
				t.children.push(this.parseSmartTag(n, t));
				break;
			case "bookmarkStart":
				t.children.push(ot(n, F));
				break;
			case "bookmarkEnd":
				t.children.push(st(n, F));
				break;
			case "commentRangeStart":
				t.children.push(new ht(F.attr(n, "id")));
				break;
			case "commentRangeEnd":
				t.children.push(new gt(F.attr(n, "id")));
				break;
			case "oMath":
			case "oMathPara":
				t.children.push(this.parseMathElement(n));
				break;
			case "sdt":
				t.children.push(...this.parseSdt(n, (e) => this.parseParagraph(e).children));
				break;
			case "ins":
				t.children.push(this.parseInserted(n, (e) => this.parseParagraph(e)));
				break;
			case "del":
				t.children.push(this.parseDeleted(n, (e) => this.parseParagraph(e)));
				break;
		}
		return t;
	}
	parseParagraphProperties(e, t) {
		this.parseDefaultProperties(e, t.cssStyle = {}, null, (e) => {
			if (ge(e, t, F)) return !0;
			switch (e.localName) {
				case "pStyle":
					t.styleName = F.attr(e, "val");
					break;
				case "cnfStyle":
					t.className = Ct.classNameOfCnfStyle(e);
					break;
				case "framePr":
					this.parseFrame(e, t);
					break;
				case "rPr": break;
				default: return !1;
			}
			return !0;
		});
	}
	parseFrame(e, t) {
		F.attr(e, "dropCap") == "drop" && (t.cssStyle.float = "left");
	}
	parseHyperlink(e, t) {
		var n = {
			type: H.Hyperlink,
			parent: t,
			children: []
		};
		n.anchor = F.attr(e, "anchor"), n.id = F.attr(e, "id");
		for (let t of F.elements(e)) switch (t.localName) {
			case "r":
				n.children.push(this.parseRun(t, n));
				break;
		}
		return n;
	}
	parseSmartTag(e, t) {
		var n = {
			type: H.SmartTag,
			parent: t,
			children: []
		}, r = F.attr(e, "uri"), i = F.attr(e, "element");
		r && (n.uri = r), i && (n.element = i);
		for (let t of F.elements(e)) switch (t.localName) {
			case "r":
				n.children.push(this.parseRun(t, n));
				break;
		}
		return n;
	}
	parseRun(e, t) {
		var n = {
			type: H.Run,
			parent: t,
			children: []
		};
		for (let t of F.elements(e)) switch (t = this.checkAlternateContent(t), t.localName) {
			case "t":
				n.children.push({
					type: H.Text,
					text: t.textContent
				});
				break;
			case "delText":
				n.children.push({
					type: H.DeletedText,
					text: t.textContent
				});
				break;
			case "commentReference":
				n.children.push(new mt(F.attr(t, "id")));
				break;
			case "fldSimple":
				n.children.push({
					type: H.SimpleField,
					instruction: F.attr(t, "instr"),
					lock: F.boolAttr(t, "lock", !1),
					dirty: F.boolAttr(t, "dirty", !1)
				});
				break;
			case "instrText":
				n.fieldRun = !0, n.children.push({
					type: H.Instruction,
					text: t.textContent
				});
				break;
			case "fldChar":
				n.fieldRun = !0, n.children.push({
					type: H.ComplexField,
					charType: F.attr(t, "fldCharType"),
					lock: F.boolAttr(t, "lock", !1),
					dirty: F.boolAttr(t, "dirty", !1)
				});
				break;
			case "noBreakHyphen":
				n.children.push({ type: H.NoBreakHyphen });
				break;
			case "br":
				n.children.push({
					type: H.Break,
					break: F.attr(t, "type") || "textWrapping"
				});
				break;
			case "lastRenderedPageBreak":
				n.children.push({
					type: H.Break,
					break: "lastRenderedPageBreak"
				});
				break;
			case "sym":
				n.children.push({
					type: H.Symbol,
					font: _(F.attr(t, "font")),
					char: F.attr(t, "char")
				});
				break;
			case "tab":
				n.children.push({ type: H.Tab });
				break;
			case "footnoteReference":
				n.children.push({
					type: H.FootnoteReference,
					id: F.attr(t, "id")
				});
				break;
			case "endnoteReference":
				n.children.push({
					type: H.EndnoteReference,
					id: F.attr(t, "id")
				});
				break;
			case "drawing":
				let e = this.parseDrawing(t);
				e && (n.children = [e]);
				break;
			case "pict":
				n.children.push(this.parseVmlPicture(t));
				break;
			case "rPr":
				this.parseRunProperties(t, n);
				break;
		}
		return n;
	}
	parseMathElement(e) {
		let t = `${e.localName}Pr`, n = {
			type: yt[e.localName],
			children: []
		};
		for (let i of F.elements(e)) if (yt[i.localName]) n.children.push(this.parseMathElement(i));
		else if (i.localName == "r") {
			var r = this.parseRun(i);
			r.type = H.MmlRun, n.children.push(r);
		} else i.localName == t && (n.props = this.parseMathProperies(i));
		return n;
	}
	parseMathProperies(e) {
		let t = {};
		for (let n of F.elements(e)) switch (n.localName) {
			case "chr":
				t.char = F.attr(n, "val");
				break;
			case "vertJc":
				t.verticalJustification = F.attr(n, "val");
				break;
			case "pos":
				t.position = F.attr(n, "val");
				break;
			case "degHide":
				t.hideDegree = F.boolAttr(n, "val");
				break;
			case "begChr":
				t.beginChar = F.attr(n, "val");
				break;
			case "endChr":
				t.endChar = F.attr(n, "val");
				break;
		}
		return t;
	}
	parseRunProperties(e, t) {
		this.parseDefaultProperties(e, t.cssStyle = {}, null, (e) => {
			switch (e.localName) {
				case "rStyle":
					t.styleName = F.attr(e, "val");
					break;
				case "vertAlign":
					t.verticalAlign = Ct.valueOfVertAlign(e, !0);
					break;
				default: return !1;
			}
			return !0;
		});
	}
	parseVmlPicture(e) {
		let t = {
			type: H.VmlPicture,
			children: []
		};
		for (let n of F.elements(e)) {
			let e = lt(n, this);
			e && t.children.push(e);
		}
		return t;
	}
	checkAlternateContent(e) {
		var t;
		if (e.localName != "AlternateContent") return e;
		var n = F.element(e, "Choice");
		if (n) {
			var r = F.attr(n, "Requires"), i = e.lookupNamespaceURI(r);
			if (vt.includes(i)) return n.firstElementChild;
		}
		return (t = F.element(e, "Fallback")) == null ? void 0 : t.firstElementChild;
	}
	parseDrawing(e) {
		for (var t of F.elements(e)) switch (t.localName) {
			case "inline":
			case "anchor": return this.parseDrawingWrapper(t);
		}
	}
	parseDrawingWrapper(e) {
		var t = {
			type: H.Drawing,
			children: [],
			cssStyle: {}
		}, n = e.localName == "anchor";
		let r = null, i = F.boolAttr(e, "simplePos");
		F.boolAttr(e, "behindDoc");
		let a = {
			relative: "page",
			align: "left",
			offset: "0"
		}, o = {
			relative: "page",
			align: "top",
			offset: "0"
		};
		for (var s of F.elements(e)) switch (s.localName) {
			case "simplePos":
				i && (a.offset = F.lengthAttr(s, "x", O.Emu), o.offset = F.lengthAttr(s, "y", O.Emu));
				break;
			case "extent":
				t.cssStyle.width = F.lengthAttr(s, "cx", O.Emu), t.cssStyle.height = F.lengthAttr(s, "cy", O.Emu);
				break;
			case "positionH":
			case "positionV":
				if (!i) {
					var c;
					let e = s.localName == "positionH" ? a : o;
					var l = F.element(s, "align"), u = F.element(s, "posOffset");
					e.relative = (c = F.attr(s, "relativeFrom")) == null ? e.relative : c, l && (e.align = l.textContent), u && (e.offset = k(u.textContent, O.Emu));
				}
				break;
			case "wrapTopAndBottom":
				r = "wrapTopAndBottom";
				break;
			case "wrapNone":
				r = "wrapNone";
				break;
			case "graphic":
				var d = this.parseGraphic(s);
				d && t.children.push(d);
				break;
		}
		return r == "wrapTopAndBottom" ? (t.cssStyle.display = "block", a.align && (t.cssStyle["text-align"] = a.align, t.cssStyle.width = "100%")) : r == "wrapNone" ? (t.cssStyle.display = "block", t.cssStyle.position = "relative", t.cssStyle.width = "0px", t.cssStyle.height = "0px", a.offset && (t.cssStyle.left = a.offset), o.offset && (t.cssStyle.top = o.offset)) : n && (a.align == "left" || a.align == "right") && (t.cssStyle.float = a.align), t;
	}
	parseGraphic(e) {
		var t = F.element(e, "graphicData");
		for (let e of F.elements(t)) switch (e.localName) {
			case "pic": return this.parsePicture(e);
		}
		return null;
	}
	parsePicture(e) {
		var t = {
			type: H.Image,
			src: "",
			cssStyle: {}
		}, n = F.element(e, "blipFill"), r = F.element(n, "blip"), i = F.element(n, "srcRect");
		t.src = F.attr(r, "embed"), i && (t.srcRect = [
			F.intAttr(i, "l", 0) / 1e5,
			F.intAttr(i, "t", 0) / 1e5,
			F.intAttr(i, "r", 0) / 1e5,
			F.intAttr(i, "b", 0) / 1e5
		]);
		var a = F.element(e, "spPr"), o = F.element(a, "xfrm");
		if (t.cssStyle.position = "relative", o) {
			t.rotation = F.intAttr(o, "rot", 0) / 6e4;
			for (var s of F.elements(o)) switch (s.localName) {
				case "ext":
					t.cssStyle.width = F.lengthAttr(s, "cx", O.Emu), t.cssStyle.height = F.lengthAttr(s, "cy", O.Emu);
					break;
				case "off":
					t.cssStyle.left = F.lengthAttr(s, "x", O.Emu), t.cssStyle.top = F.lengthAttr(s, "y", O.Emu);
					break;
			}
		}
		return t;
	}
	parseTable(e) {
		var t = {
			type: H.Table,
			children: []
		};
		for (let n of F.elements(e)) switch (n.localName) {
			case "tr":
				t.children.push(this.parseTableRow(n));
				break;
			case "tblGrid":
				t.columns = this.parseTableColumns(n);
				break;
			case "tblPr":
				this.parseTableProperties(n, t);
				break;
		}
		return t;
	}
	parseTableColumns(e) {
		var t = [];
		for (let n of F.elements(e)) switch (n.localName) {
			case "gridCol":
				t.push({ width: F.lengthAttr(n, "w") });
				break;
		}
		return t;
	}
	parseTableProperties(e, t) {
		switch (t.cssStyle = {}, t.cellStyle = {}, this.parseDefaultProperties(e, t.cssStyle, t.cellStyle, (e) => {
			switch (e.localName) {
				case "tblStyle":
					t.styleName = F.attr(e, "val");
					break;
				case "tblLook":
					t.className = Ct.classNameOftblLook(e);
					break;
				case "tblpPr":
					this.parseTablePosition(e, t);
					break;
				case "tblStyleColBandSize":
					t.colBandSize = F.intAttr(e, "val");
					break;
				case "tblStyleRowBandSize":
					t.rowBandSize = F.intAttr(e, "val");
					break;
				case "hidden":
					t.cssStyle.display = "none";
					break;
				default: return !1;
			}
			return !0;
		}), t.cssStyle["text-align"]) {
			case "center":
				delete t.cssStyle["text-align"], t.cssStyle["margin-left"] = "auto", t.cssStyle["margin-right"] = "auto";
				break;
			case "right":
				delete t.cssStyle["text-align"], t.cssStyle["margin-left"] = "auto";
				break;
		}
	}
	parseTablePosition(e, t) {
		var n = F.lengthAttr(e, "topFromText"), r = F.lengthAttr(e, "bottomFromText"), i = F.lengthAttr(e, "rightFromText"), a = F.lengthAttr(e, "leftFromText");
		t.cssStyle.float = "left", t.cssStyle["margin-bottom"] = Ct.addSize(t.cssStyle["margin-bottom"], r), t.cssStyle["margin-left"] = Ct.addSize(t.cssStyle["margin-left"], a), t.cssStyle["margin-right"] = Ct.addSize(t.cssStyle["margin-right"], i), t.cssStyle["margin-top"] = Ct.addSize(t.cssStyle["margin-top"], n);
	}
	parseTableRow(e) {
		var t = {
			type: H.Row,
			children: []
		};
		for (let n of F.elements(e)) switch (n.localName) {
			case "tc":
				t.children.push(this.parseTableCell(n));
				break;
			case "trPr":
			case "tblPrEx":
				this.parseTableRowProperties(n, t);
				break;
		}
		return t;
	}
	parseTableRowProperties(e, t) {
		t.cssStyle = this.parseDefaultProperties(e, {}, null, (e) => {
			switch (e.localName) {
				case "cnfStyle":
					t.className = Ct.classNameOfCnfStyle(e);
					break;
				case "tblHeader":
					t.isHeader = F.boolAttr(e, "val");
					break;
				case "gridBefore":
					t.gridBefore = F.intAttr(e, "val");
					break;
				case "gridAfter":
					t.gridAfter = F.intAttr(e, "val");
					break;
				default: return !1;
			}
			return !0;
		});
	}
	parseTableCell(e) {
		var t = {
			type: H.Cell,
			children: []
		};
		for (let n of F.elements(e)) switch (n.localName) {
			case "tbl":
				t.children.push(this.parseTable(n));
				break;
			case "p":
				t.children.push(this.parseParagraph(n));
				break;
			case "tcPr":
				this.parseTableCellProperties(n, t);
				break;
		}
		return t;
	}
	parseTableCellProperties(e, t) {
		t.cssStyle = this.parseDefaultProperties(e, {}, null, (e) => {
			switch (e.localName) {
				case "gridSpan":
					t.span = F.intAttr(e, "val", null);
					break;
				case "vMerge":
					var n;
					t.verticalMerge = (n = F.attr(e, "val")) == null ? "continue" : n;
					break;
				case "cnfStyle":
					t.className = Ct.classNameOfCnfStyle(e);
					break;
				default: return !1;
			}
			return !0;
		}), this.parseTableCellVerticalText(e, t);
	}
	parseTableCellVerticalText(e, t) {
		let n = {
			btLr: {
				writingMode: "vertical-rl",
				transform: "rotate(180deg)"
			},
			lrTb: {
				writingMode: "vertical-lr",
				transform: "none"
			},
			tbRl: {
				writingMode: "vertical-rl",
				transform: "none"
			}
		};
		for (let r of F.elements(e)) if (r.localName === "textDirection") {
			let e = n[F.attr(r, "val")] || { writingMode: "horizontal-tb" };
			t.cssStyle["writing-mode"] = e.writingMode, t.cssStyle.transform = e.transform;
		}
	}
	parseDefaultProperties(e, t = null, n = null, r = null) {
		t = t || {};
		for (let i of F.elements(e)) if (!(r != null && r(i))) switch (i.localName) {
			case "jc":
				t["text-align"] = Ct.valueOfJc(i);
				break;
			case "textAlignment":
				t["vertical-align"] = Ct.valueOfTextAlignment(i);
				break;
			case "color":
				t.color = St.colorAttr(i, "val", null, _t.color);
				break;
			case "sz":
				t["font-size"] = t["min-height"] = F.lengthAttr(i, "val", O.FontSize);
				break;
			case "shd":
				t["background-color"] = St.colorAttr(i, "fill", null, _t.shd);
				break;
			case "highlight":
				t["background-color"] = St.colorAttr(i, "val", null, _t.highlight);
				break;
			case "vertAlign": break;
			case "position":
				t.verticalAlign = F.lengthAttr(i, "val", O.FontSize);
				break;
			case "tcW": if (this.options.ignoreWidth) break;
			case "tblW":
				t.width = Ct.valueOfSize(i, "w");
				break;
			case "trHeight":
				this.parseTrHeight(i, t);
				break;
			case "strike":
				t["text-decoration"] = F.boolAttr(i, "val", !0) ? "line-through" : "none";
				break;
			case "b":
				t["font-weight"] = F.boolAttr(i, "val", !0) ? "bold" : "normal";
				break;
			case "i":
				t["font-style"] = F.boolAttr(i, "val", !0) ? "italic" : "normal";
				break;
			case "caps":
				t["text-transform"] = F.boolAttr(i, "val", !0) ? "uppercase" : "none";
				break;
			case "smallCaps":
				t["font-variant"] = F.boolAttr(i, "val", !0) ? "small-caps" : "none";
				break;
			case "u":
				this.parseUnderline(i, t);
				break;
			case "ind":
			case "tblInd":
				this.parseIndentation(i, t);
				break;
			case "rFonts":
				this.parseFont(i, t);
				break;
			case "tblBorders":
				this.parseBorderProperties(i, n || t);
				break;
			case "tblCellSpacing":
				t["border-spacing"] = Ct.valueOfMargin(i), t["border-collapse"] = "separate";
				break;
			case "pBdr":
				this.parseBorderProperties(i, t);
				break;
			case "bdr":
				t.border = Ct.valueOfBorder(i);
				break;
			case "tcBorders":
				this.parseBorderProperties(i, t);
				break;
			case "vanish":
				F.boolAttr(i, "val", !0) && (t.display = "none");
				break;
			case "kern": break;
			case "noWrap": break;
			case "tblCellMar":
			case "tcMar":
				this.parseMarginProperties(i, n || t);
				break;
			case "tblLayout":
				t["table-layout"] = Ct.valueOfTblLayout(i);
				break;
			case "vAlign":
				t["vertical-align"] = Ct.valueOfTextAlignment(i);
				break;
			case "spacing":
				e.localName == "pPr" && this.parseSpacing(i, t);
				break;
			case "wordWrap":
				F.boolAttr(i, "val") && (t["overflow-wrap"] = "break-word");
				break;
			case "suppressAutoHyphens":
				t.hyphens = F.boolAttr(i, "val", !0) ? "none" : "auto";
				break;
			case "lang":
				t.$lang = F.attr(i, "val");
				break;
			case "rtl":
			case "bidi":
				F.boolAttr(i, "val", !0) && (t.direction = "rtl");
				break;
			case "bCs":
			case "iCs":
			case "szCs":
			case "tabs":
			case "outlineLvl":
			case "contextualSpacing":
			case "tblStyleColBandSize":
			case "tblStyleRowBandSize":
			case "webHidden":
			case "pageBreakBefore":
			case "suppressLineNumbers":
			case "keepLines":
			case "keepNext":
			case "widowControl":
			case "bidi":
			case "rtl":
			case "noProof": break;
			default:
				this.options.debug && console.warn(`DOCX: Unknown document element: ${e.localName}.${i.localName}`);
				break;
		}
		return t;
	}
	parseUnderline(e, t) {
		var n = F.attr(e, "val");
		if (n != null) {
			switch (n) {
				case "dash":
				case "dashDotDotHeavy":
				case "dashDotHeavy":
				case "dashedHeavy":
				case "dashLong":
				case "dashLongHeavy":
				case "dotDash":
				case "dotDotDash":
					t["text-decoration"] = "underline dashed";
					break;
				case "dotted":
				case "dottedHeavy":
					t["text-decoration"] = "underline dotted";
					break;
				case "double":
					t["text-decoration"] = "underline double";
					break;
				case "single":
				case "thick":
					t["text-decoration"] = "underline";
					break;
				case "wave":
				case "wavyDouble":
				case "wavyHeavy":
					t["text-decoration"] = "underline wavy";
					break;
				case "words":
					t["text-decoration"] = "underline";
					break;
				case "none":
					t["text-decoration"] = "none";
					break;
			}
			var r = St.colorAttr(e, "color");
			r && (t["text-decoration-color"] = r);
		}
	}
	parseFont(e, t) {
		var n = [
			F.attr(e, "ascii"),
			Ct.themeValue(e, "asciiTheme"),
			F.attr(e, "eastAsia")
		].filter((e) => e).map((e) => _(e));
		n.length > 0 && (t["font-family"] = [...new Set(n)].join(", "));
	}
	parseIndentation(e, t) {
		var n = F.lengthAttr(e, "firstLine"), r = F.lengthAttr(e, "hanging"), i = F.lengthAttr(e, "left"), a = F.lengthAttr(e, "start"), o = F.lengthAttr(e, "right"), s = F.lengthAttr(e, "end");
		n && (t["text-indent"] = n), r && (t["text-indent"] = `-${r}`), (i || a) && (t["margin-inline-start"] = i || a), (o || s) && (t["margin-inline-end"] = o || s);
	}
	parseSpacing(e, t) {
		var n = F.lengthAttr(e, "before"), r = F.lengthAttr(e, "after"), i = F.intAttr(e, "line", null), a = F.attr(e, "lineRule");
		if (n && (t["margin-top"] = n), r && (t["margin-bottom"] = r), i !== null) switch (a) {
			case "auto":
				t["line-height"] = `${(i / 240).toFixed(2)}`;
				break;
			case "atLeast":
				t["line-height"] = `calc(100% + ${i / 20}pt)`;
				break;
			default:
				t["line-height"] = t["min-height"] = `${i / 20}pt`;
				break;
		}
	}
	parseMarginProperties(e, t) {
		for (let n of F.elements(e)) switch (n.localName) {
			case "left":
				t["padding-left"] = Ct.valueOfMargin(n);
				break;
			case "right":
				t["padding-right"] = Ct.valueOfMargin(n);
				break;
			case "top":
				t["padding-top"] = Ct.valueOfMargin(n);
				break;
			case "bottom":
				t["padding-bottom"] = Ct.valueOfMargin(n);
				break;
		}
	}
	parseTrHeight(e, t) {
		switch (F.attr(e, "hRule")) {
			case "exact":
				t.height = F.lengthAttr(e, "val");
				break;
			default:
				t.height = F.lengthAttr(e, "val");
				break;
		}
	}
	parseBorderProperties(e, t) {
		for (let n of F.elements(e)) switch (n.localName) {
			case "start":
			case "left":
				t["border-left"] = Ct.valueOfBorder(n);
				break;
			case "end":
			case "right":
				t["border-right"] = Ct.valueOfBorder(n);
				break;
			case "top":
				t["border-top"] = Ct.valueOfBorder(n);
				break;
			case "bottom":
				t["border-bottom"] = Ct.valueOfBorder(n);
				break;
		}
	}
}, xt = [
	"black",
	"blue",
	"cyan",
	"darkBlue",
	"darkCyan",
	"darkGray",
	"darkGreen",
	"darkMagenta",
	"darkRed",
	"darkYellow",
	"green",
	"lightGray",
	"magenta",
	"none",
	"red",
	"white",
	"yellow"
], St = class {
	static colorAttr(e, t, n = null, r = "black") {
		var i = F.attr(e, t);
		if (i) return i == "auto" ? r : xt.includes(i) ? i : `#${i}`;
		var a = F.attr(e, "themeColor");
		return a ? `var(--docx-${a}-color)` : n;
	}
}, Ct = class e {
	static themeValue(e, t) {
		var n = F.attr(e, t);
		return n ? `var(--docx-${n}-font)` : null;
	}
	static valueOfSize(e, t) {
		var n = O.Dxa;
		switch (F.attr(e, "type")) {
			case "dxa": break;
			case "pct":
				n = O.Percent;
				break;
			case "auto": return "auto";
		}
		return F.lengthAttr(e, t, n);
	}
	static valueOfMargin(e) {
		return F.lengthAttr(e, "w");
	}
	static valueOfBorder(t) {
		var n = e.parseBorderType(F.attr(t, "val"));
		if (n == "none") return "none";
		var r = St.colorAttr(t, "color");
		return `${F.lengthAttr(t, "sz", O.Border)} ${n} ${r == "auto" ? _t.borderColor : r}`;
	}
	static parseBorderType(e) {
		switch (e) {
			case "single": return "solid";
			case "dashDotStroked": return "solid";
			case "dashed": return "dashed";
			case "dashSmallGap": return "dashed";
			case "dotDash": return "dotted";
			case "dotDotDash": return "dotted";
			case "dotted": return "dotted";
			case "double": return "double";
			case "doubleWave": return "double";
			case "inset": return "inset";
			case "nil": return "none";
			case "none": return "none";
			case "outset": return "outset";
			case "thick": return "solid";
			case "thickThinLargeGap": return "solid";
			case "thickThinMediumGap": return "solid";
			case "thickThinSmallGap": return "solid";
			case "thinThickLargeGap": return "solid";
			case "thinThickMediumGap": return "solid";
			case "thinThickSmallGap": return "solid";
			case "thinThickThinLargeGap": return "solid";
			case "thinThickThinMediumGap": return "solid";
			case "thinThickThinSmallGap": return "solid";
			case "threeDEmboss": return "solid";
			case "threeDEngrave": return "solid";
			case "triple": return "double";
			case "wave": return "solid";
		}
		return "solid";
	}
	static valueOfTblLayout(e) {
		return F.attr(e, "val") == "fixed" ? "fixed" : "auto";
	}
	static classNameOfCnfStyle(e) {
		let t = F.attr(e, "val");
		return [
			"first-row",
			"last-row",
			"first-col",
			"last-col",
			"odd-col",
			"even-col",
			"odd-row",
			"even-row",
			"ne-cell",
			"nw-cell",
			"se-cell",
			"sw-cell"
		].filter((e, n) => t[n] == "1").join(" ");
	}
	static valueOfJc(e) {
		var t = F.attr(e, "val");
		switch (t) {
			case "start":
			case "left": return "left";
			case "center": return "center";
			case "end":
			case "right": return "right";
			case "both": return "justify";
		}
		return t;
	}
	static valueOfVertAlign(e, t = !1) {
		var n = F.attr(e, "val");
		switch (n) {
			case "subscript": return "sub";
			case "superscript": return t ? "sup" : "super";
		}
		return t ? null : n;
	}
	static valueOfTextAlignment(e) {
		var t = F.attr(e, "val");
		switch (t) {
			case "auto":
			case "baseline": return "baseline";
			case "top": return "top";
			case "center": return "middle";
			case "bottom": return "bottom";
		}
		return t;
	}
	static addSize(e, t) {
		return e == null ? t : t == null ? e : `calc(${e} + ${t})`;
	}
	static classNameOftblLook(e) {
		let t = F.hexAttr(e, "val", 0), n = "";
		return (F.boolAttr(e, "firstRow") || t & 32) && (n += " first-row"), (F.boolAttr(e, "lastRow") || t & 64) && (n += " last-row"), (F.boolAttr(e, "firstColumn") || t & 128) && (n += " first-col"), (F.boolAttr(e, "lastColumn") || t & 256) && (n += " last-col"), (F.boolAttr(e, "noHBand") || t & 512) && (n += " no-hband"), (F.boolAttr(e, "noVBand") || t & 1024) && (n += " no-vband"), n.trim();
	}
}, wt = {
	pos: 0,
	leader: "none",
	style: "left"
}, Tt = 50;
function Et(e = document.body) {
	let t = document.createElement("div");
	t.style.width = "100pt", e.appendChild(t);
	let n = 100 / t.offsetWidth;
	return e.removeChild(t), n;
}
function Dt(e, t, n, r = 72 / 96) {
	let i = e.closest("p"), a = e.getBoundingClientRect(), o = i.getBoundingClientRect(), s = getComputedStyle(i), c = (t == null ? void 0 : t.length) > 0 ? t.map((e) => ({
		pos: Ot(e.position),
		leader: e.leader,
		style: e.style
	})).sort((e, t) => e.pos - t.pos) : [wt], l = c[c.length - 1], u = o.width * r, d = Ot(n), f = l.pos + d;
	if (f < u) for (; f < u && c.length < Tt; f += d) c.push({
		...wt,
		pos: f
	});
	let p = parseFloat(s.marginLeft), m = o.left + p, h = (a.left - m) * r, g = c.find((e) => e.style != "clear" && e.pos > h);
	if (g == null) return;
	let _ = 1;
	if (g.style == "right" || g.style == "center") {
		let t = Array.from(i.querySelectorAll(`.${e.className}`)), n = t.indexOf(e) + 1, a = document.createRange();
		a.setStart(e, 1), n < t.length ? a.setEndBefore(t[n]) : a.setEndAfter(i);
		let s = g.style == "center" ? .5 : 1, c = a.getBoundingClientRect(), l = c.left + s * c.width - (o.left - p);
		_ = g.pos - l * r;
	} else _ = g.pos - h;
	switch (e.innerHTML = "&nbsp;", e.style.textDecoration = "inherit", e.style.wordSpacing = `${_.toFixed(0)}pt`, g.leader) {
		case "dot":
		case "middleDot":
			e.style.textDecoration = "underline", e.style.textDecorationStyle = "dotted";
			break;
		case "hyphen":
		case "heavy":
		case "underscore":
			e.style.textDecoration = "underline";
			break;
	}
}
function Ot(e) {
	return parseFloat(e);
}
var U = {
	svg: "http://www.w3.org/2000/svg",
	mathML: "http://www.w3.org/1998/Math/MathML"
}, kt = class {
	constructor(e) {
		this.htmlDocument = e, this.className = "docx", this.styleMap = {}, this.currentPart = null, this.tableVerticalMerges = [], this.currentVerticalMerge = null, this.tableCellPositions = [], this.currentCellPosition = null, this.footnoteMap = {}, this.endnoteMap = {}, this.currentEndnoteIds = [], this.usedHederFooterParts = [], this.currentTabs = [], this.commentMap = {}, this.tasks = [], this.postRenderTasks = [];
	}
	async render(e, t, n = null, r) {
		if (this.document = e, this.options = r, this.className = r.className, this.rootSelector = r.inWrapper ? `.${this.className}-wrapper` : ":root", this.styleMap = null, this.tasks = [], this.options.renderComments && globalThis.Highlight && (this.commentHighlight = new Highlight()), n = n || t, At(n), At(t), n.appendChild(this.createComment("docxjs library predefined styles")), n.appendChild(this.renderDefaultStyle()), e.themePart && (n.appendChild(this.createComment("docxjs document theme values")), this.renderTheme(e.themePart, n)), e.stylesPart != null && (this.styleMap = this.processStyles(e.stylesPart.styles), n.appendChild(this.createComment("docxjs document styles")), n.appendChild(this.renderStyles(e.stylesPart.styles))), e.numberingPart && (this.prodessNumberings(e.numberingPart.domNumberings), n.appendChild(this.createComment("docxjs document numbering styles")), n.appendChild(this.renderNumbering(e.numberingPart.domNumberings, n))), e.footnotesPart && (this.footnoteMap = b(e.footnotesPart.notes, (e) => e.id)), e.endnotesPart && (this.endnoteMap = b(e.endnotesPart.notes, (e) => e.id)), e.settingsPart) {
			var i;
			this.defaultTabSize = (i = e.settingsPart.settings) == null ? void 0 : i.defaultTabStop;
		}
		!r.ignoreFonts && e.fontTablePart && this.renderFontTable(e.fontTablePart, n);
		var a = this.renderSections(e.documentPart.body);
		this.options.inWrapper ? t.appendChild(this.renderWrapper(a)) : jt(t, a), this.commentHighlight && r.renderComments && CSS.highlights.set(`${this.className}-comments`, this.commentHighlight), this.postRenderTasks.forEach((e) => e()), await Promise.allSettled(this.tasks), this.refreshTabStops();
	}
	renderTheme(e, t) {
		var n, r;
		let i = {}, a = (n = e.theme) == null ? void 0 : n.fontScheme;
		a && (a.majorFont && (i["--docx-majorHAnsi-font"] = a.majorFont.latinTypeface), a.minorFont && (i["--docx-minorHAnsi-font"] = a.minorFont.latinTypeface));
		let o = (r = e.theme) == null ? void 0 : r.colorScheme;
		if (o) for (let [e, t] of Object.entries(o.colors)) i[`--docx-${e}-color`] = `#${t}`;
		let s = this.styleToString(`.${this.className}`, i);
		t.appendChild(this.createStyleElement(s));
	}
	renderFontTable(e, t) {
		for (let n of e.fonts) for (let e of n.embedFontRefs) this.tasks.push(this.document.loadFont(e.id, e.key).then((r) => {
			let i = {
				"font-family": _(n.name),
				src: `url(${r})`
			};
			(e.type == "bold" || e.type == "boldItalic") && (i["font-weight"] = "bold"), (e.type == "italic" || e.type == "boldItalic") && (i["font-style"] = "italic");
			let a = this.styleToString("@font-face", i);
			t.appendChild(this.createComment(`docxjs ${n.name} font`)), t.appendChild(this.createStyleElement(a));
		}));
	}
	processStyleName(e) {
		return e ? `${this.className}_${g(e)}` : this.className;
	}
	processStyles(e) {
		let t = b(e.filter((e) => e.id != null), (e) => e.id);
		for (let r of e.filter((e) => e.basedOn)) {
			var n = t[r.basedOn];
			if (n) {
				r.paragraphProps = w(r.paragraphProps, n.paragraphProps), r.runProps = w(r.runProps, n.runProps);
				for (let e of n.styles) {
					let t = r.styles.find((t) => t.target == e.target);
					t ? this.copyStyleProperties(e.values, t.values) : r.styles.push({
						...e,
						values: { ...e.values }
					});
				}
			} else this.options.debug && console.warn(`Can't find base style ${r.basedOn}`);
		}
		for (let t of e) t.cssName = this.processStyleName(t.id);
		return t;
	}
	prodessNumberings(e) {
		for (let n of e.filter((e) => e.pStyleName)) {
			var t;
			let e = this.findStyle(n.pStyleName);
			!(e == null || (t = e.paragraphProps) == null) && t.numbering && (e.paragraphProps.numbering.level = n.level);
		}
	}
	processElement(e) {
		if (e.children) for (var t of e.children) t.parent = e, t.type == H.Table ? this.processTable(t) : this.processElement(t);
	}
	processTable(e) {
		for (var t of e.children) for (var n of t.children) n.cssStyle = this.copyStyleProperties(e.cellStyle, n.cssStyle, [
			"border-left",
			"border-right",
			"border-top",
			"border-bottom",
			"padding-left",
			"padding-right",
			"padding-top",
			"padding-bottom"
		]), this.processElement(n);
	}
	copyStyleProperties(e, t, n = null) {
		if (!e) return t;
		t == null && (t = {}), n == null && (n = Object.getOwnPropertyNames(e));
		for (var r of n) e.hasOwnProperty(r) && !t.hasOwnProperty(r) && (t[r] = e[r]);
		return t;
	}
	createPageElement(e, t) {
		var n = this.createElement("section", { className: e });
		return t && (t.pageMargins && (n.style.paddingLeft = t.pageMargins.left, n.style.paddingRight = t.pageMargins.right, n.style.paddingTop = t.pageMargins.top, n.style.paddingBottom = t.pageMargins.bottom), t.pageSize && (this.options.ignoreWidth || (n.style.width = t.pageSize.width), this.options.ignoreHeight || (n.style.minHeight = t.pageSize.height))), n;
	}
	createSectionContent(e) {
		var t = this.createElement("article");
		return e.columns && e.columns.numberOfColumns && (t.style.columnCount = `${e.columns.numberOfColumns}`, t.style.columnGap = e.columns.space, e.columns.separator && (t.style.columnRule = "1px solid black")), t;
	}
	renderSections(e) {
		let t = [];
		this.processElement(e);
		let n = this.splitBySection(e.children, e.props), r = this.groupByPageBreaks(n), i = null;
		for (let n = 0, o = r.length; n < o; n++) {
			this.currentFootnoteIds = [];
			let s = r[n][0].sectProps, c = this.createPageElement(this.className, s);
			this.renderStyleValues(e.cssStyle, c), this.options.renderHeaders && this.renderHeaderFooter(s.headerRefs, s, t.length, i != s, c);
			for (let e of r[n]) {
				var a = this.createSectionContent(e.sectProps);
				this.renderElements(e.elements, a), c.appendChild(a), s = e.sectProps;
			}
			this.options.renderFootnotes && this.renderNotes(this.currentFootnoteIds, this.footnoteMap, c), this.options.renderEndnotes && n == o - 1 && this.renderNotes(this.currentEndnoteIds, this.endnoteMap, c), this.options.renderFooters && this.renderHeaderFooter(s.footerRefs, s, t.length, i != s, c), t.push(c), i = s;
		}
		return t;
	}
	renderHeaderFooter(e, t, n, r, i) {
		var a, o;
		if (e) {
			var s = (a = (o = t.titlePage && r ? e.find((e) => e.type == "first") : null) == null ? n % 2 == 1 ? e.find((e) => e.type == "even") : null : o) == null ? e.find((e) => e.type == "default") : a, c = s && this.document.findPartByRelId(s.id, this.document.documentPart);
			if (c) {
				this.currentPart = c, this.usedHederFooterParts.includes(c.path) || (this.processElement(c.rootElement), this.usedHederFooterParts.push(c.path));
				let [e] = this.renderElements([c.rootElement], i);
				t != null && t.pageMargins && (c.rootElement.type === H.Header ? (e.style.marginTop = `calc(${t.pageMargins.header} - ${t.pageMargins.top})`, e.style.minHeight = `calc(${t.pageMargins.top} - ${t.pageMargins.header})`) : c.rootElement.type === H.Footer && (e.style.marginBottom = `calc(${t.pageMargins.footer} - ${t.pageMargins.bottom})`, e.style.minHeight = `calc(${t.pageMargins.bottom} - ${t.pageMargins.footer})`)), this.currentPart = null;
			}
		}
	}
	isPageBreakElement(e) {
		return e.type == H.Break ? e.break == "lastRenderedPageBreak" ? !this.options.ignoreLastRenderedPageBreak : e.break == "page" : !1;
	}
	isPageBreakSection(e, t) {
		var n, r, i, a, o, s;
		return !e || !t ? !1 : ((n = e.pageSize) == null ? void 0 : n.orientation) != ((r = t.pageSize) == null ? void 0 : r.orientation) || ((i = e.pageSize) == null ? void 0 : i.width) != ((a = t.pageSize) == null ? void 0 : a.width) || ((o = e.pageSize) == null ? void 0 : o.height) != ((s = t.pageSize) == null ? void 0 : s.height);
	}
	splitBySection(e, t) {
		var n = {
			sectProps: null,
			elements: [],
			pageBreak: !1
		}, r = [n];
		for (let t of e) {
			if (t.type == H.Paragraph) {
				var i;
				let e = this.findStyle(t.styleName);
				!(e == null || (i = e.paragraphProps) == null) && i.pageBreakBefore && (n.sectProps = a, n.pageBreak = !0, n = {
					sectProps: null,
					elements: [],
					pageBreak: !1
				}, r.push(n));
			}
			if (n.elements.push(t), t.type == H.Paragraph) {
				let e = t;
				var a = e.sectionProps, o = -1, s = -1;
				if (this.options.breakPages && e.children && (o = e.children.findIndex((e) => {
					var t, n;
					return s = (t = (n = e.children) == null ? void 0 : n.findIndex(this.isPageBreakElement.bind(this))) == null ? -1 : t, s != -1;
				})), (a || o != -1) && (n.sectProps = a, n.pageBreak = o != -1, n = {
					sectProps: null,
					elements: [],
					pageBreak: !1
				}, r.push(n)), o != -1) {
					let r = e.children[o], i = s < r.children.length - 1;
					if (o < e.children.length - 1 || i) {
						var c = t.children, l = {
							...t,
							children: c.slice(o)
						};
						if (t.children = c.slice(0, o), n.elements.push(l), i) {
							let e = r.children, n = {
								...r,
								children: e.slice(0, s)
							};
							t.children.push(n), r.children = e.slice(s);
						}
					}
				}
			}
		}
		let u = null;
		for (let e = r.length - 1; e >= 0; e--) if (r[e].sectProps == null) {
			var d;
			r[e].sectProps = (d = u) == null ? t : d;
		} else u = r[e].sectProps;
		return r;
	}
	groupByPageBreaks(e) {
		let t = [], n, r = [t];
		for (let i of e) t.push(i), (this.options.ignoreLastRenderedPageBreak || i.pageBreak || this.isPageBreakSection(n, i.sectProps)) && r.push(t = []), n = i.sectProps;
		return r.filter((e) => e.length > 0);
	}
	renderWrapper(e) {
		return this.createElement("div", { className: `${this.className}-wrapper` }, e);
	}
	renderDefaultStyle() {
		var e = this.className, t = `
.${e}-wrapper { background: gray; padding: 30px; padding-bottom: 0px; display: flex; flex-flow: column; align-items: center; } 
.${e}-wrapper>section.${e} { background: white; box-shadow: 0 0 10px rgba(0, 0, 0, 0.5); margin-bottom: 30px; }`;
		this.options.hideWrapperOnPrint && (t = `@media not print { ${t} }`);
		var n = `${t}
.${e} { color: black; hyphens: auto; text-underline-position: from-font; }
section.${e} { box-sizing: border-box; display: flex; flex-flow: column nowrap; position: relative; overflow: hidden; }
section.${e}>article { margin-bottom: auto; z-index: 1; }
section.${e}>footer { z-index: 1; }
.${e} table { border-collapse: collapse; }
.${e} table td, .${e} table th { vertical-align: top; }
.${e} p { margin: 0pt; min-height: 1em; }
.${e} span { white-space: pre-wrap; overflow-wrap: break-word; }
.${e} a { color: inherit; text-decoration: inherit; }
.${e} svg { fill: transparent; }
`;
		return this.options.renderComments && (n += `
.${e}-comment-ref { cursor: default; }
.${e}-comment-popover { display: none; z-index: 1000; padding: 0.5rem; background: white; position: absolute; box-shadow: 0 0 0.25rem rgba(0, 0, 0, 0.25); width: 30ch; }
.${e}-comment-ref:hover~.${e}-comment-popover { display: block; }
.${e}-comment-author,.${e}-comment-date { font-size: 0.875rem; color: #888; }
`), this.createStyleElement(n);
	}
	renderNumbering(e, t) {
		var n = "", r = [];
		for (var i of e) {
			var a = `p.${this.numberingClass(i.id, i.level)}`, o = "none";
			if (i.bullet) {
				let e = `--${this.className}-${i.bullet.src}`.toLowerCase();
				n += this.styleToString(`${a}:before`, {
					content: "' '",
					display: "inline-block",
					background: `var(${e})`
				}, i.bullet.style), this.tasks.push(this.document.loadNumberingImage(i.bullet.src).then((n) => {
					var r = `${this.rootSelector} { ${e}: url(${n}) }`;
					t.appendChild(this.createStyleElement(r));
				}));
			} else if (i.levelText) {
				let e = this.numberingCounter(i.id, i.level), t = e + " " + (i.start - 1);
				i.level > 0 && (n += this.styleToString(`p.${this.numberingClass(i.id, i.level - 1)}`, { "counter-set": t })), r.push(t), n += this.styleToString(`${a}:before`, {
					content: this.levelTextToContent(i.levelText, i.suff, i.id, this.numFormatToCssValue(i.format)),
					"counter-increment": e,
					...i.rStyle
				});
			} else o = this.numFormatToCssValue(i.format);
			n += this.styleToString(a, {
				display: "list-item",
				"list-style-position": "inside",
				"list-style-type": o,
				...i.pStyle
			});
		}
		return r.length > 0 && (n += this.styleToString(this.rootSelector, { "counter-reset": r.join(" ") })), this.createStyleElement(n);
	}
	renderStyles(e) {
		var t = "";
		let n = this.styleMap, r = b(e.filter((e) => e.isDefault), (e) => e.target);
		for (let c of e) {
			var i = c.styles;
			if (c.linked) {
				var a = c.linked && n[c.linked];
				a ? i = i.concat(a.styles) : this.options.debug && console.warn(`Can't find linked style ${c.linked}`);
			}
			for (let e of i) {
				var o, s = `${(o = c.target) == null ? "" : o}.${c.cssName}`;
				c.target != e.target && (s += ` ${e.target}`), r[c.target] == c && (s = `.${this.className} ${c.target}, ` + s), t += this.styleToString(s, e.values);
			}
		}
		return this.createStyleElement(t);
	}
	renderNotes(e, t, n) {
		var r = e.map((e) => t[e]).filter((e) => e);
		if (r.length > 0) {
			var i = this.createElement("ol", null, this.renderElements(r));
			n.appendChild(i);
		}
	}
	renderElement(e) {
		switch (e.type) {
			case H.Paragraph: return this.renderParagraph(e);
			case H.BookmarkStart: return this.renderBookmarkStart(e);
			case H.BookmarkEnd: return null;
			case H.Run: return this.renderRun(e);
			case H.Table: return this.renderTable(e);
			case H.Row: return this.renderTableRow(e);
			case H.Cell: return this.renderTableCell(e);
			case H.Hyperlink: return this.renderHyperlink(e);
			case H.SmartTag: return this.renderSmartTag(e);
			case H.Drawing: return this.renderDrawing(e);
			case H.Image: return this.renderImage(e);
			case H.Text: return this.renderText(e);
			case H.Text: return this.renderText(e);
			case H.DeletedText: return this.renderDeletedText(e);
			case H.Tab: return this.renderTab(e);
			case H.Symbol: return this.renderSymbol(e);
			case H.Break: return this.renderBreak(e);
			case H.Footer: return this.renderContainer(e, "footer");
			case H.Header: return this.renderContainer(e, "header");
			case H.Footnote:
			case H.Endnote: return this.renderContainer(e, "li");
			case H.FootnoteReference: return this.renderFootnoteReference(e);
			case H.EndnoteReference: return this.renderEndnoteReference(e);
			case H.NoBreakHyphen: return this.createElement("wbr");
			case H.VmlPicture: return this.renderVmlPicture(e);
			case H.VmlElement: return this.renderVmlElement(e);
			case H.MmlMath: return this.renderContainerNS(e, U.mathML, "math", { xmlns: U.mathML });
			case H.MmlMathParagraph: return this.renderContainer(e, "span");
			case H.MmlFraction: return this.renderContainerNS(e, U.mathML, "mfrac");
			case H.MmlBase: return this.renderContainerNS(e, U.mathML, e.parent.type == H.MmlMatrixRow ? "mtd" : "mrow");
			case H.MmlNumerator:
			case H.MmlDenominator:
			case H.MmlFunction:
			case H.MmlLimit:
			case H.MmlBox: return this.renderContainerNS(e, U.mathML, "mrow");
			case H.MmlGroupChar: return this.renderMmlGroupChar(e);
			case H.MmlLimitLower: return this.renderContainerNS(e, U.mathML, "munder");
			case H.MmlMatrix: return this.renderContainerNS(e, U.mathML, "mtable");
			case H.MmlMatrixRow: return this.renderContainerNS(e, U.mathML, "mtr");
			case H.MmlRadical: return this.renderMmlRadical(e);
			case H.MmlSuperscript: return this.renderContainerNS(e, U.mathML, "msup");
			case H.MmlSubscript: return this.renderContainerNS(e, U.mathML, "msub");
			case H.MmlDegree:
			case H.MmlSuperArgument:
			case H.MmlSubArgument: return this.renderContainerNS(e, U.mathML, "mn");
			case H.MmlFunctionName: return this.renderContainerNS(e, U.mathML, "ms");
			case H.MmlDelimiter: return this.renderMmlDelimiter(e);
			case H.MmlRun: return this.renderMmlRun(e);
			case H.MmlNary: return this.renderMmlNary(e);
			case H.MmlPreSubSuper: return this.renderMmlPreSubSuper(e);
			case H.MmlBar: return this.renderMmlBar(e);
			case H.MmlEquationArray: return this.renderMllList(e);
			case H.Inserted: return this.renderInserted(e);
			case H.Deleted: return this.renderDeleted(e);
			case H.CommentRangeStart: return this.renderCommentRangeStart(e);
			case H.CommentRangeEnd: return this.renderCommentRangeEnd(e);
			case H.CommentReference: return this.renderCommentReference(e);
			case H.AltChunk: return this.renderAltChunk(e);
		}
		return null;
	}
	renderElements(e, t) {
		if (e == null) return null;
		var n = e.flatMap((e) => this.renderElement(e)).filter((e) => e != null);
		return t && jt(t, n), n;
	}
	renderContainer(e, t, n) {
		return this.createElement(t, n, this.renderElements(e.children));
	}
	renderContainerNS(e, t, n, r) {
		return this.createElementNS(t, n, r, this.renderElements(e.children));
	}
	renderParagraph(e) {
		var t, n, r, i = this.renderContainer(e, "p");
		let a = this.findStyle(e.styleName);
		e.tabs != null || (e.tabs = a == null || (t = a.paragraphProps) == null ? void 0 : t.tabs), this.renderClass(e, i), this.renderStyleValues(e.cssStyle, i), this.renderCommonProperties(i.style, e);
		let o = (n = e.numbering) == null ? a == null || (r = a.paragraphProps) == null ? void 0 : r.numbering : n;
		return o && i.classList.add(this.numberingClass(o.id, o.level)), i;
	}
	renderRunProperties(e, t) {
		this.renderCommonProperties(e, t);
	}
	renderCommonProperties(e, t) {
		t != null && (t.color && (e.color = t.color), t.fontSize && (e["font-size"] = t.fontSize));
	}
	renderHyperlink(e) {
		var t = this.renderContainer(e, "a");
		this.renderStyleValues(e.cssStyle, t);
		let n = "";
		if (e.id) {
			var r;
			let t = this.document.documentPart.rels.find((t) => t.id == e.id && t.targetMode === "External");
			n = (r = t == null ? void 0 : t.target) == null ? n : r;
		}
		return e.anchor && (n += `#${e.anchor}`), t.href = n, t;
	}
	renderSmartTag(e) {
		return this.renderContainer(e, "span");
	}
	renderCommentRangeStart(e) {
		var t;
		if (!this.options.renderComments) return null;
		let n = new Range();
		(t = this.commentHighlight) == null || t.add(n);
		let r = this.createComment(`start of comment #${e.id}`);
		return this.later(() => n.setStart(r, 0)), this.commentMap[e.id] = n, r;
	}
	renderCommentRangeEnd(e) {
		if (!this.options.renderComments) return null;
		let t = this.commentMap[e.id], n = this.createComment(`end of comment #${e.id}`);
		return this.later(() => t == null ? void 0 : t.setEnd(n, 0)), n;
	}
	renderCommentReference(e) {
		var t;
		if (!this.options.renderComments) return null;
		var n = (t = this.document.commentsPart) == null ? void 0 : t.commentMap[e.id];
		if (!n) return null;
		let r = new DocumentFragment(), i = this.createElement("span", { className: `${this.className}-comment-ref` }, ["💬"]), a = this.createElement("div", { className: `${this.className}-comment-popover` });
		return this.renderCommentContent(n, a), r.appendChild(this.createComment(`comment #${n.id} by ${n.author} on ${n.date}`)), r.appendChild(i), r.appendChild(a), r;
	}
	renderAltChunk(e) {
		if (!this.options.renderAltChunks) return null;
		var t = this.createElement("iframe");
		return this.tasks.push(this.document.loadAltChunk(e.id, this.currentPart).then((e) => {
			t.srcdoc = e;
		})), t;
	}
	renderCommentContent(e, t) {
		t.appendChild(this.createElement("div", { className: `${this.className}-comment-author` }, [e.author])), t.appendChild(this.createElement("div", { className: `${this.className}-comment-date` }, [new Date(e.date).toLocaleString()])), this.renderElements(e.children, t);
	}
	renderDrawing(e) {
		var t = this.renderContainer(e, "div");
		return t.style.display = "inline-block", t.style.position = "relative", t.style.textIndent = "0px", this.renderStyleValues(e.cssStyle, t), t;
	}
	renderImage(e) {
		var t, n;
		let r = this.createElement("img"), i = (t = e.cssStyle) == null ? void 0 : t.transform;
		if (this.renderStyleValues(e.cssStyle, r), e.srcRect && e.srcRect.some((e) => e != 0)) {
			var [a, o, s, c] = e.srcRect;
			i = `scale(${1 / (1 - a - s)}, ${1 / (1 - o - c)})`, r.style["clip-path"] = `rect(${(100 * o).toFixed(2)}% ${(100 * (1 - s)).toFixed(2)}% ${(100 * (1 - c)).toFixed(2)}% ${(100 * a).toFixed(2)}%)`;
		}
		return e.rotation && (i = `rotate(${e.rotation}deg) ${(n = i) == null ? "" : n}`), r.style.transform = i == null ? void 0 : i.trim(), this.document && this.tasks.push(this.document.loadDocumentImage(e.src, this.currentPart).then((e) => {
			r.src = e;
		})), r;
	}
	renderText(e) {
		return this.htmlDocument.createTextNode(e.text);
	}
	renderDeletedText(e) {
		return this.options.renderChanges ? this.renderText(e) : null;
	}
	renderBreak(e) {
		return e.break == "textWrapping" ? this.createElement("br") : null;
	}
	renderInserted(e) {
		return this.options.renderChanges ? this.renderContainer(e, "ins") : this.renderElements(e.children);
	}
	renderDeleted(e) {
		return this.options.renderChanges ? this.renderContainer(e, "del") : null;
	}
	renderSymbol(e) {
		var t = this.createElement("span");
		return t.style.fontFamily = e.font, t.innerHTML = `&#x${e.char};`, t;
	}
	renderFootnoteReference(e) {
		var t = this.createElement("sup");
		return this.currentFootnoteIds.push(e.id), t.textContent = `${this.currentFootnoteIds.length}`, t;
	}
	renderEndnoteReference(e) {
		var t = this.createElement("sup");
		return this.currentEndnoteIds.push(e.id), t.textContent = `${this.currentEndnoteIds.length}`, t;
	}
	renderTab(e) {
		var t = this.createElement("span");
		if (t.innerHTML = "&emsp;", this.options.experimental) {
			var n;
			t.className = this.tabStopClass();
			var r = (n = Mt(e, H.Paragraph)) == null ? void 0 : n.tabs;
			this.currentTabs.push({
				stops: r,
				span: t
			});
		}
		return t;
	}
	renderBookmarkStart(e) {
		return this.createElement("span", { id: e.name });
	}
	renderRun(e) {
		if (e.fieldRun) return null;
		let t = this.createElement("span");
		if (e.id && (t.id = e.id), this.renderClass(e, t), this.renderStyleValues(e.cssStyle, t), e.verticalAlign) {
			let n = this.createElement(e.verticalAlign);
			this.renderElements(e.children, n), t.appendChild(n);
		} else this.renderElements(e.children, t);
		return t;
	}
	renderTable(e) {
		let t = this.createElement("table");
		return this.tableCellPositions.push(this.currentCellPosition), this.tableVerticalMerges.push(this.currentVerticalMerge), this.currentVerticalMerge = {}, this.currentCellPosition = {
			col: 0,
			row: 0
		}, e.columns && t.appendChild(this.renderTableColumns(e.columns)), this.renderClass(e, t), this.renderElements(e.children, t), this.renderStyleValues(e.cssStyle, t), this.currentVerticalMerge = this.tableVerticalMerges.pop(), this.currentCellPosition = this.tableCellPositions.pop(), t;
	}
	renderTableColumns(e) {
		let t = this.createElement("colgroup");
		for (let n of e) {
			let e = this.createElement("col");
			n.width && (e.style.width = n.width), t.appendChild(e);
		}
		return t;
	}
	renderTableRow(e) {
		let t = this.createElement("tr");
		return this.currentCellPosition.col = 0, e.gridBefore && t.appendChild(this.renderTableCellPlaceholder(e.gridBefore)), this.renderClass(e, t), this.renderElements(e.children, t), this.renderStyleValues(e.cssStyle, t), e.gridAfter && t.appendChild(this.renderTableCellPlaceholder(e.gridAfter)), this.currentCellPosition.row++, t;
	}
	renderTableCellPlaceholder(e) {
		let t = this.createElement("td", { colSpan: e });
		return t.style.border = "none", t;
	}
	renderTableCell(e) {
		let t = this.renderContainer(e, "td"), n = this.currentCellPosition.col;
		return e.verticalMerge ? e.verticalMerge == "restart" ? (this.currentVerticalMerge[n] = t, t.rowSpan = 1) : this.currentVerticalMerge[n] && (this.currentVerticalMerge[n].rowSpan += 1, t.style.display = "none") : this.currentVerticalMerge[n] = null, this.renderClass(e, t), this.renderStyleValues(e.cssStyle, t), e.span && (t.colSpan = e.span), this.currentCellPosition.col += t.colSpan, t;
	}
	renderVmlPicture(e) {
		return this.renderContainer(e, "div");
	}
	renderVmlElement(e) {
		var t, n = this.createSvgElement("svg");
		n.setAttribute("style", e.cssStyleText);
		let r = this.renderVmlChildElement(e);
		if ((t = e.imageHref) != null && t.id) {
			var i;
			this.tasks.push((i = this.document) == null ? void 0 : i.loadDocumentImage(e.imageHref.id, this.currentPart).then((e) => r.setAttribute("href", e)));
		}
		return n.appendChild(r), requestAnimationFrame(() => {
			let e = n.firstElementChild.getBBox();
			n.setAttribute("width", `${Math.ceil(e.x + e.width)}`), n.setAttribute("height", `${Math.ceil(e.y + e.height)}`);
		}), n;
	}
	renderVmlChildElement(e) {
		let t = this.createSvgElement(e.tagName);
		Object.entries(e.attrs).forEach(([e, n]) => t.setAttribute(e, n));
		for (let n of e.children) n.type == H.VmlElement ? t.appendChild(this.renderVmlChildElement(n)) : t.appendChild(...T(this.renderElement(n)));
		return t;
	}
	renderMmlRadical(e) {
		var t;
		let n = e.children.find((e) => e.type == H.MmlBase);
		if ((t = e.props) != null && t.hideDegree) return this.createElementNS(U.mathML, "msqrt", null, this.renderElements([n]));
		let r = e.children.find((e) => e.type == H.MmlDegree);
		return this.createElementNS(U.mathML, "mroot", null, this.renderElements([n, r]));
	}
	renderMmlDelimiter(e) {
		var t, n;
		let r = [];
		return r.push(this.createElementNS(U.mathML, "mo", null, [(t = e.props.beginChar) == null ? "(" : t])), r.push(...this.renderElements(e.children)), r.push(this.createElementNS(U.mathML, "mo", null, [(n = e.props.endChar) == null ? ")" : n])), this.createElementNS(U.mathML, "mrow", null, r);
	}
	renderMmlNary(e) {
		var t, n;
		let r = [], i = b(e.children, (e) => e.type), a = i[H.MmlSuperArgument], o = i[H.MmlSubArgument], s = a ? this.createElementNS(U.mathML, "mo", null, T(this.renderElement(a))) : null, c = o ? this.createElementNS(U.mathML, "mo", null, T(this.renderElement(o))) : null, l = this.createElementNS(U.mathML, "mo", null, [(t = (n = e.props) == null ? void 0 : n.char) == null ? "∫" : t]);
		return s || c ? r.push(this.createElementNS(U.mathML, "munderover", null, [
			l,
			c,
			s
		])) : s ? r.push(this.createElementNS(U.mathML, "mover", null, [l, s])) : c ? r.push(this.createElementNS(U.mathML, "munder", null, [l, c])) : r.push(l), r.push(...this.renderElements(i[H.MmlBase].children)), this.createElementNS(U.mathML, "mrow", null, r);
	}
	renderMmlPreSubSuper(e) {
		let t = [], n = b(e.children, (e) => e.type), r = n[H.MmlSuperArgument], i = n[H.MmlSubArgument], a = r ? this.createElementNS(U.mathML, "mo", null, T(this.renderElement(r))) : null, o = i ? this.createElementNS(U.mathML, "mo", null, T(this.renderElement(i))) : null, s = this.createElementNS(U.mathML, "mo", null);
		return t.push(this.createElementNS(U.mathML, "msubsup", null, [
			s,
			o,
			a
		])), t.push(...this.renderElements(n[H.MmlBase].children)), this.createElementNS(U.mathML, "mrow", null, t);
	}
	renderMmlGroupChar(e) {
		let t = e.props.verticalJustification === "bot" ? "mover" : "munder", n = this.renderContainerNS(e, U.mathML, t);
		return e.props.char && n.appendChild(this.createElementNS(U.mathML, "mo", null, [e.props.char])), n;
	}
	renderMmlBar(e) {
		let t = this.renderContainerNS(e, U.mathML, "mrow");
		switch (e.props.position) {
			case "top":
				t.style.textDecoration = "overline";
				break;
			case "bottom":
				t.style.textDecoration = "underline";
				break;
		}
		return t;
	}
	renderMmlRun(e) {
		let t = this.createElementNS(U.mathML, "ms", null, this.renderElements(e.children));
		return this.renderClass(e, t), this.renderStyleValues(e.cssStyle, t), t;
	}
	renderMllList(e) {
		let t = this.createElementNS(U.mathML, "mtable");
		this.renderClass(e, t), this.renderStyleValues(e.cssStyle, t);
		for (let n of this.renderElements(e.children)) t.appendChild(this.createElementNS(U.mathML, "mtr", null, [this.createElementNS(U.mathML, "mtd", null, [n])]));
		return t;
	}
	renderStyleValues(e, t) {
		for (let n in e) n.startsWith("$") ? t.setAttribute(n.slice(1), e[n]) : t.style[n] = e[n];
	}
	renderClass(e, t) {
		e.className && (t.className = e.className), e.styleName && t.classList.add(this.processStyleName(e.styleName));
	}
	findStyle(e) {
		var t;
		return e && ((t = this.styleMap) == null ? void 0 : t[e]);
	}
	numberingClass(e, t) {
		return `${this.className}-num-${e}-${t}`;
	}
	tabStopClass() {
		return `${this.className}-tab-stop`;
	}
	styleToString(e, t, n = null) {
		let r = `${e} {\r\n`;
		for (let e in t) e.startsWith("$") || (r += `  ${e}: ${t[e]};\r\n`);
		return n && (r += n), r + "}\r\n";
	}
	numberingCounter(e, t) {
		return `${this.className}-num-${e}-${t}`;
	}
	levelTextToContent(e, t, n, r) {
		var i;
		return `"${e.replace(/%\d*/g, (e) => {
			let t = parseInt(e.substring(1), 10) - 1;
			return `"counter(${this.numberingCounter(n, t)}, ${r})"`;
		})}${(i = {
			tab: "\\9",
			space: "\\a0"
		}[t]) == null ? "" : i}"`;
	}
	numFormatToCssValue(e) {
		var t;
		return (t = {
			none: "none",
			bullet: "disc",
			decimal: "decimal",
			lowerLetter: "lower-alpha",
			upperLetter: "upper-alpha",
			lowerRoman: "lower-roman",
			upperRoman: "upper-roman",
			decimalZero: "decimal-leading-zero",
			aiueo: "katakana",
			aiueoFullWidth: "katakana",
			chineseCounting: "simp-chinese-informal",
			chineseCountingThousand: "simp-chinese-informal",
			chineseLegalSimplified: "simp-chinese-formal",
			chosung: "hangul-consonant",
			ideographDigital: "cjk-ideographic",
			ideographTraditional: "cjk-heavenly-stem",
			ideographLegalTraditional: "trad-chinese-formal",
			ideographZodiac: "cjk-earthly-branch",
			iroha: "katakana-iroha",
			irohaFullWidth: "katakana-iroha",
			japaneseCounting: "japanese-informal",
			japaneseDigitalTenThousand: "cjk-decimal",
			japaneseLegal: "japanese-formal",
			thaiNumbers: "thai",
			koreanCounting: "korean-hangul-formal",
			koreanDigital: "korean-hangul-formal",
			koreanDigital2: "korean-hanja-informal",
			hebrew1: "hebrew",
			hebrew2: "hebrew",
			hindiNumbers: "devanagari",
			ganada: "hangul",
			taiwaneseCounting: "cjk-ideographic",
			taiwaneseCountingThousand: "cjk-ideographic",
			taiwaneseDigital: "cjk-decimal"
		}[e]) == null ? e : t;
	}
	refreshTabStops() {
		this.options.experimental && setTimeout(() => {
			let e = Et();
			for (let t of this.currentTabs) Dt(t.span, t.stops, this.defaultTabSize, e);
		}, 500);
	}
	createElementNS(e, t, n, r) {
		var i = e ? this.htmlDocument.createElementNS(e, t) : this.htmlDocument.createElement(t);
		return Object.assign(i, n), r && jt(i, r), i;
	}
	createElement(e, t, n) {
		return this.createElementNS(void 0, e, t, n);
	}
	createSvgElement(e, t, n) {
		return this.createElementNS(U.svg, e, t, n);
	}
	createStyleElement(e) {
		return this.createElement("style", { innerHTML: e });
	}
	createComment(e) {
		return this.htmlDocument.createComment(e);
	}
	later(e) {
		this.postRenderTasks.push(e);
	}
};
function At(e) {
	e.innerHTML = "";
}
function jt(e, t) {
	t.forEach((t) => e.appendChild(C(t) ? document.createTextNode(t) : t));
}
function Mt(e, t) {
	for (var n = e.parent; n != null && n.type != t;) n = n.parent;
	return n;
}
var Nt = {
	ignoreHeight: !1,
	ignoreWidth: !1,
	ignoreFonts: !1,
	breakPages: !0,
	debug: !1,
	experimental: !1,
	className: "docx",
	inWrapper: !0,
	hideWrapperOnPrint: !1,
	trimXmlDeclaration: !0,
	ignoreLastRenderedPageBreak: !0,
	renderHeaders: !0,
	renderFooters: !0,
	renderFootnotes: !0,
	renderEndnotes: !0,
	useBase64URL: !1,
	renderChanges: !1,
	renderComments: !1,
	renderAltChunks: !0
};
function Pt(e, t) {
	let n = {
		...Nt,
		...t
	};
	return it.load(e, new bt(n), n);
}
async function Ft(e, t, n, r) {
	let i = {
		...Nt,
		...r
	};
	return await new kt(window.document).render(e, t, n, i);
}
async function It(e, t, n, r) {
	let i = await Pt(e, r);
	return await Ft(i, t, n, r), i;
}
//#endregion
//#region node_modules/.pnpm/@xmldom+xmldom@0.9.10/node_modules/@xmldom/xmldom/lib/conventions.js
var Lt = /* @__PURE__ */ s(((e) => {
	function t(e, t, n) {
		if (n === void 0 && (n = Array.prototype), e && typeof n.find == "function") return n.find.call(e, t);
		for (var i = 0; i < e.length; i++) if (r(e, i)) {
			var a = e[i];
			if (t.call(void 0, a, i, e)) return a;
		}
	}
	function n(e, t) {
		return t === void 0 && (t = Object), t && typeof t.getOwnPropertyDescriptors == "function" && (e = t.create(null, t.getOwnPropertyDescriptors(e))), t && typeof t.freeze == "function" ? t.freeze(e) : e;
	}
	function r(e, t) {
		return Object.prototype.hasOwnProperty.call(e, t);
	}
	function i(e, t) {
		if (typeof e != "object" || !e) throw TypeError("target is not an object");
		for (var n in t) r(t, n) && (e[n] = t[n]);
		return e;
	}
	var a = n({
		allowfullscreen: !0,
		async: !0,
		autofocus: !0,
		autoplay: !0,
		checked: !0,
		controls: !0,
		default: !0,
		defer: !0,
		disabled: !0,
		formnovalidate: !0,
		hidden: !0,
		ismap: !0,
		itemscope: !0,
		loop: !0,
		multiple: !0,
		muted: !0,
		nomodule: !0,
		novalidate: !0,
		open: !0,
		playsinline: !0,
		readonly: !0,
		required: !0,
		reversed: !0,
		selected: !0
	});
	function o(e) {
		return r(a, e.toLowerCase());
	}
	var s = n({
		area: !0,
		base: !0,
		br: !0,
		col: !0,
		embed: !0,
		hr: !0,
		img: !0,
		input: !0,
		link: !0,
		meta: !0,
		param: !0,
		source: !0,
		track: !0,
		wbr: !0
	});
	function c(e) {
		return r(s, e.toLowerCase());
	}
	var l = n({
		script: !1,
		style: !1,
		textarea: !0,
		title: !0
	});
	function u(e) {
		var t = e.toLowerCase();
		return r(l, t) && !l[t];
	}
	function d(e) {
		var t = e.toLowerCase();
		return r(l, t) && l[t];
	}
	function f(e) {
		return e === m.HTML;
	}
	function p(e) {
		return f(e) || e === m.XML_XHTML_APPLICATION;
	}
	var m = n({
		HTML: "text/html",
		XML_APPLICATION: "application/xml",
		XML_TEXT: "text/xml",
		XML_XHTML_APPLICATION: "application/xhtml+xml",
		XML_SVG_IMAGE: "image/svg+xml"
	}), h = Object.keys(m).map(function(e) {
		return m[e];
	});
	function g(e) {
		return h.indexOf(e) > -1;
	}
	var _ = n({
		HTML: "http://www.w3.org/1999/xhtml",
		SVG: "http://www.w3.org/2000/svg",
		XML: "http://www.w3.org/XML/1998/namespace",
		XMLNS: "http://www.w3.org/2000/xmlns/"
	});
	e.assign = i, e.find = t, e.freeze = n, e.HTML_BOOLEAN_ATTRIBUTES = a, e.HTML_RAW_TEXT_ELEMENTS = l, e.HTML_VOID_ELEMENTS = s, e.hasDefaultHTMLNamespace = p, e.hasOwn = r, e.isHTMLBooleanAttribute = o, e.isHTMLRawTextElement = u, e.isHTMLEscapableRawTextElement = d, e.isHTMLMimeType = f, e.isHTMLVoidElement = c, e.isValidMimeType = g, e.MIME_TYPE = m, e.NAMESPACE = _;
})), Rt = /* @__PURE__ */ s(((e) => {
	var t = Lt();
	function n(e, t) {
		e.prototype = Object.create(Error.prototype, {
			constructor: { value: e },
			name: {
				value: e.name,
				enumerable: !0,
				writable: t
			}
		});
	}
	var r = t.freeze({
		Error: "Error",
		IndexSizeError: "IndexSizeError",
		DomstringSizeError: "DomstringSizeError",
		HierarchyRequestError: "HierarchyRequestError",
		WrongDocumentError: "WrongDocumentError",
		InvalidCharacterError: "InvalidCharacterError",
		NoDataAllowedError: "NoDataAllowedError",
		NoModificationAllowedError: "NoModificationAllowedError",
		NotFoundError: "NotFoundError",
		NotSupportedError: "NotSupportedError",
		InUseAttributeError: "InUseAttributeError",
		InvalidStateError: "InvalidStateError",
		SyntaxError: "SyntaxError",
		InvalidModificationError: "InvalidModificationError",
		NamespaceError: "NamespaceError",
		InvalidAccessError: "InvalidAccessError",
		ValidationError: "ValidationError",
		TypeMismatchError: "TypeMismatchError",
		SecurityError: "SecurityError",
		NetworkError: "NetworkError",
		AbortError: "AbortError",
		URLMismatchError: "URLMismatchError",
		QuotaExceededError: "QuotaExceededError",
		TimeoutError: "TimeoutError",
		InvalidNodeTypeError: "InvalidNodeTypeError",
		DataCloneError: "DataCloneError",
		EncodingError: "EncodingError",
		NotReadableError: "NotReadableError",
		UnknownError: "UnknownError",
		ConstraintError: "ConstraintError",
		DataError: "DataError",
		TransactionInactiveError: "TransactionInactiveError",
		ReadOnlyError: "ReadOnlyError",
		VersionError: "VersionError",
		OperationError: "OperationError",
		NotAllowedError: "NotAllowedError",
		OptOutError: "OptOutError"
	}), i = Object.keys(r);
	function a(e) {
		return typeof e == "number" && e >= 1 && e <= 25;
	}
	function o(e) {
		return typeof e == "string" && e.substring(e.length - r.Error.length) === r.Error;
	}
	function s(e, t) {
		a(e) ? (this.name = i[e], this.message = t || "") : (this.message = e, this.name = o(t) ? t : r.Error), Error.captureStackTrace && Error.captureStackTrace(this, s);
	}
	n(s, !0), Object.defineProperties(s.prototype, { code: {
		enumerable: !0,
		get: function() {
			var e = i.indexOf(this.name);
			return a(e) ? e : 0;
		}
	} });
	for (var c = {
		INDEX_SIZE_ERR: 1,
		DOMSTRING_SIZE_ERR: 2,
		HIERARCHY_REQUEST_ERR: 3,
		WRONG_DOCUMENT_ERR: 4,
		INVALID_CHARACTER_ERR: 5,
		NO_DATA_ALLOWED_ERR: 6,
		NO_MODIFICATION_ALLOWED_ERR: 7,
		NOT_FOUND_ERR: 8,
		NOT_SUPPORTED_ERR: 9,
		INUSE_ATTRIBUTE_ERR: 10,
		INVALID_STATE_ERR: 11,
		SYNTAX_ERR: 12,
		INVALID_MODIFICATION_ERR: 13,
		NAMESPACE_ERR: 14,
		INVALID_ACCESS_ERR: 15,
		VALIDATION_ERR: 16,
		TYPE_MISMATCH_ERR: 17,
		SECURITY_ERR: 18,
		NETWORK_ERR: 19,
		ABORT_ERR: 20,
		URL_MISMATCH_ERR: 21,
		QUOTA_EXCEEDED_ERR: 22,
		TIMEOUT_ERR: 23,
		INVALID_NODE_TYPE_ERR: 24,
		DATA_CLONE_ERR: 25
	}, l = Object.entries(c), u = 0; u < l.length; u++) {
		var d = l[u][0];
		s[d] = l[u][1];
	}
	function f(e, t) {
		this.message = e, this.locator = t, Error.captureStackTrace && Error.captureStackTrace(this, f);
	}
	n(f), e.DOMException = s, e.DOMExceptionName = r, e.ExceptionCode = c, e.ParseError = f;
})), zt = /* @__PURE__ */ s(((e) => {
	function t(e) {
		try {
			typeof e != "function" && (e = RegExp);
			var t = new e("𝌆", "u").exec("𝌆");
			return !!t && t[0].length === 2;
		} catch {}
		return !1;
	}
	var n = t();
	function r(e) {
		if (e.source[0] !== "[") throw Error(e + " can not be used with chars");
		return e.source.slice(1, e.source.lastIndexOf("]"));
	}
	function i(e, t) {
		if (e.source[0] !== "[") throw Error("/" + e.source + "/ can not be used with chars_without");
		if (!t || typeof t != "string") throw Error(JSON.stringify(t) + " is not a valid search");
		if (e.source.indexOf(t) === -1) throw Error("\"" + t + "\" is not is /" + e.source + "/");
		if (t === "-" && e.source.indexOf(t) !== 1) throw Error("\"" + t + "\" is not at the first postion of /" + e.source + "/");
		return new RegExp(e.source.replace(t, ""), n ? "u" : "");
	}
	function a(e) {
		var t = this;
		return new RegExp(Array.prototype.slice.call(arguments).map(function(e) {
			var n = typeof e == "string";
			if (n && t === void 0 && e === "|") throw Error("use regg instead of reg to wrap expressions with `|`!");
			return n ? e : e.source;
		}).join(""), n ? "mu" : "m");
	}
	function o(e) {
		if (arguments.length === 0) throw Error("no parameters provided");
		return a.apply(o, ["(?:"].concat(Array.prototype.slice.call(arguments), [")"]));
	}
	var s = "�", c = /[-\x09\x0A\x0D\x20-\x2C\x2E-\uD7FF\uE000-\uFFFD]/;
	n && (c = a("[", r(c), "\\u{10000}-\\u{10FFFF}", "]"));
	var l = RegExp("[^" + r(c) + "]", n ? "u" : ""), u = /[\x20\x09\x0D\x0A]/, d = r(u), f = a(u, "+"), p = a(u, "*"), m = /[:_a-zA-Z\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/;
	n && (m = a("[", r(m), "\\u{10000}-\\u{10FFFF}", "]"));
	var h = a("[", r(m), r(/[-.0-9\xB7]/), r(/[\u0300-\u036F\u203F-\u2040]/), "]"), g = a(m, h, "*"), _ = a(h, "+"), v = o(a("&", g, ";"), "|", o(/&#[0-9]+;|&#x[0-9a-fA-F]+;/)), y = a("%", g, ";"), b = o(a("\"", o(/[^%&"]/, "|", y, "|", v), "*", "\""), "|", a("'", o(/[^%&']/, "|", y, "|", v), "*", "'")), x = o("\"", o(/[^<&"]/, "|", v), "*", "\"", "|", "'", o(/[^<&']/, "|", v), "*", "'"), S = a(i(m, ":"), i(h, ":"), "*"), C = a(S, o(":", S), "?"), w = a("^", C, "$"), T = a("(", C, ")"), E = o(/"[^"]*"|'[^']*'/), D = a(/^<\?/, "(", g, ")", o(f, "(", c, "*?)"), "?", /\?>/), O = /[\x20\x0D\x0Aa-zA-Z0-9-'()+,./:=?;!*#@$_%]/, k = o("\"", O, "*\"", "|", "'", i(O, "'"), "*'"), A = "<!--", j = "-->", M = a(A, o(i(c, "-"), "|", a("-", i(c, "-"))), "*", j), ee = "#PCDATA", te = o("EMPTY", "|", "ANY", "|", o(a(/\(/, p, ee, o(p, /\|/, p, C), "*", p, /\)\*/), "|", a(/\(/, p, ee, p, /\)/)), "|", a(/\([^>]+\)/, /[?*+]?/)), N = a("<!ELEMENT", f, o(C, "|", y), f, o(te, "|", y), p, ">"), P = a("<!ATTLIST", f, g, o(f, g, f, o(/CDATA|ID|IDREF|IDREFS|ENTITY|ENTITIES|NMTOKEN|NMTOKENS/, "|", o(a("NOTATION", f, /\(/, p, g, o(p, /\|/, p, g), "*", p, /\)/), "|", a(/\(/, p, _, o(p, /\|/, p, _), "*", p, /\)/))), f, o(/#REQUIRED|#IMPLIED/, "|", o(o("#FIXED", f), "?", x))), "*", p, ">"), F = "about:legacy-compat", I = o("\"" + F + "\"", "|", "'" + F + "'"), L = "SYSTEM", R = "PUBLIC", z = o(o(L, f, E), "|", o(R, f, k, f, E)), ne = a("^", o(o(L, f, "(?<SystemLiteralOnly>", E, ")"), "|", o(R, f, "(?<PubidLiteral>", k, ")", f, "(?<SystemLiteral>", E, ")"))), B = a("^", k, "$"), re = a("^", E, "$"), ie = o(b, "|", o(z, o(f, "NDATA", f, g), "?")), ae = "<!ENTITY", oe = o(a(ae, f, g, f, ie, p, ">"), "|", a(ae, f, "%", f, g, f, o(b, "|", z), p, ">")), se = a("<!NOTATION", f, g, f, o(z, "|", a(R, f, k)), p, ">"), V = a(p, "=", p), ce = /1[.]\d+/, le = a(f, "version", V, o("'", ce, "'", "|", "\"", ce, "\"")), ue = /[A-Za-z][-A-Za-z0-9._]*/, de = a(/^<\?xml/, le, o(f, "encoding", V, o("\"", ue, "\"", "|", "'", ue, "'")), "?", o(f, "standalone", V, o("'", o("yes", "|", "no"), "'", "|", "\"", o("yes", "|", "no"), "\"")), "?", p, /\?>/), fe = "<!DOCTYPE", pe = "<![CDATA[", me = "]]>", he = a(/<!\[CDATA\[/, a(c, "*?", /\]\]>/));
	e.chars = r, e.chars_without = i, e.detectUnicodeSupport = t, e.reg = a, e.regg = o, e.ABOUT_LEGACY_COMPAT = F, e.ABOUT_LEGACY_COMPAT_SystemLiteral = I, e.AttlistDecl = P, e.CDATA_START = pe, e.CDATA_END = me, e.CDSect = he, e.Char = c, e.Comment = M, e.COMMENT_START = A, e.COMMENT_END = j, e.DOCTYPE_DECL_START = fe, e.elementdecl = N, e.EntityDecl = oe, e.EntityValue = b, e.ExternalID = z, e.ExternalID_match = ne, e.Name = g, e.NotationDecl = se, e.Reference = v, e.PEReference = y, e.PI = D, e.PUBLIC = R, e.PubidLiteral = k, e.PubidLiteral_match = B, e.QName = C, e.QName_exact = w, e.QName_group = T, e.S = f, e.SChar_s = d, e.S_OPT = p, e.SYSTEM = L, e.SystemLiteral = E, e.SystemLiteral_match = re, e.InvalidChar = l, e.UNICODE_REPLACEMENT_CHARACTER = s, e.UNICODE_SUPPORT = n, e.XMLDecl = de;
})), Bt = /* @__PURE__ */ s(((e) => {
	var t = Lt(), n = t.find, r = t.hasDefaultHTMLNamespace, i = t.hasOwn, a = t.isHTMLMimeType, o = t.isHTMLRawTextElement, s = t.isHTMLVoidElement, c = t.MIME_TYPE, l = t.NAMESPACE, u = Symbol(), d = Rt(), f = d.DOMException, p = d.DOMExceptionName, m = zt();
	function h(e) {
		if (e !== u) throw TypeError("Illegal constructor");
	}
	function g(e) {
		return e !== "";
	}
	function _(e) {
		return e ? e.split(/[\t\n\f\r ]+/).filter(g) : [];
	}
	function v(e, t) {
		return i(e, t) || (e[t] = !0), e;
	}
	function y(e) {
		if (!e) return [];
		var t = _(e);
		return Object.keys(t.reduce(v, {}));
	}
	function b(e) {
		return function(t) {
			return e && e.indexOf(t) !== -1;
		};
	}
	function x(e) {
		if (!m.QName_exact.test(e)) throw new f(f.INVALID_CHARACTER_ERR, "invalid character in qualified name \"" + e + "\"");
	}
	function S(e, n) {
		x(n), e = e || null;
		var r = null, i = n;
		if (n.indexOf(":") >= 0) {
			var a = n.split(":");
			r = a[0], i = a[1];
		}
		if (r !== null && e === null) throw new f(f.NAMESPACE_ERR, "prefix is non-null and namespace is null");
		if (r === "xml" && e !== t.NAMESPACE.XML) throw new f(f.NAMESPACE_ERR, "prefix is \"xml\" and namespace is not the XML namespace");
		if ((r === "xmlns" || n === "xmlns") && e !== t.NAMESPACE.XMLNS) throw new f(f.NAMESPACE_ERR, "either qualifiedName or prefix is \"xmlns\" and namespace is not the XMLNS namespace");
		if (e === t.NAMESPACE.XMLNS && r !== "xmlns" && n !== "xmlns") throw new f(f.NAMESPACE_ERR, "namespace is the XMLNS namespace and neither qualifiedName nor prefix is \"xmlns\"");
		return [
			e,
			r,
			i
		];
	}
	function C(e, t) {
		for (var n in e) i(e, n) && (t[n] = e[n]);
	}
	function w(e, t) {
		var n = e.prototype;
		if (!(n instanceof t)) {
			function r() {}
			r.prototype = t.prototype, r = new r(), C(n, r), e.prototype = n = r;
		}
		n.constructor != e && (typeof e != "function" && console.error("unknown Class:" + e), n.constructor = e);
	}
	var T = {}, E = T.ELEMENT_NODE = 1, D = T.ATTRIBUTE_NODE = 2, O = T.TEXT_NODE = 3, k = T.CDATA_SECTION_NODE = 4, A = T.ENTITY_REFERENCE_NODE = 5, j = T.ENTITY_NODE = 6, M = T.PROCESSING_INSTRUCTION_NODE = 7, ee = T.COMMENT_NODE = 8, te = T.DOCUMENT_NODE = 9, N = T.DOCUMENT_TYPE_NODE = 10, P = T.DOCUMENT_FRAGMENT_NODE = 11, F = T.NOTATION_NODE = 12, I = t.freeze({
		DOCUMENT_POSITION_DISCONNECTED: 1,
		DOCUMENT_POSITION_PRECEDING: 2,
		DOCUMENT_POSITION_FOLLOWING: 4,
		DOCUMENT_POSITION_CONTAINS: 8,
		DOCUMENT_POSITION_CONTAINED_BY: 16,
		DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32
	});
	function L(e, t) {
		if (t.length < e.length) return L(t, e);
		var n = null;
		for (var r in e) {
			if (e[r] !== t[r]) return n;
			n = e[r];
		}
		return n;
	}
	function R(e) {
		return e.guid || (e.guid = Math.random()), e.guid;
	}
	function z() {}
	z.prototype = {
		length: 0,
		item: function(e) {
			return e >= 0 && e < this.length ? this[e] : null;
		},
		toString: function(e) {
			for (var t = typeof e == "function" ? {
				requireWellFormed: !1,
				splitCDATASections: !0,
				nodeFilter: e
			} : e ? {
				requireWellFormed: !!e.requireWellFormed,
				splitCDATASections: e.splitCDATASections !== !1,
				nodeFilter: e.nodeFilter || null
			} : {
				requireWellFormed: !1,
				splitCDATASections: !0,
				nodeFilter: null
			}, n = [], r = 0; r < this.length; r++) He(this[r], n, null, t);
			return n.join("");
		},
		filter: function(e) {
			return Array.prototype.filter.call(this, e);
		},
		indexOf: function(e) {
			return Array.prototype.indexOf.call(this, e);
		}
	}, z.prototype[Symbol.iterator] = function() {
		var e = this, t = 0;
		return {
			next: function() {
				return t < e.length ? {
					value: e[t++],
					done: !1
				} : { done: !0 };
			},
			return: function() {
				return { done: !0 };
			}
		};
	};
	function ne(e, t) {
		this._node = e, this._refresh = t, B(this);
	}
	function B(e) {
		var t = e._node._inc || e._node.ownerDocument._inc;
		if (e._inc !== t) {
			var n = e._refresh(e._node);
			if (Ge(e, "length", n.length), !e.$$length || n.length < e.$$length) for (var r = n.length; r in e; r++) i(e, r) && delete e[r];
			C(n, e), e._inc = t;
		}
	}
	ne.prototype.item = function(e) {
		return B(this), this[e] || null;
	}, w(ne, z);
	function re() {}
	function ie(e, t) {
		for (var n = 0; n < e.length;) {
			if (e[n] === t) return n;
			n++;
		}
	}
	function ae(e, t, n, r) {
		if (r ? t[ie(t, r)] = n : (t[t.length] = n, t.length++), e) {
			n.ownerElement = e;
			var i = e.ownerDocument;
			i && (r && pe(i, e, r), fe(i, e, n));
		}
	}
	function oe(e, t, n) {
		var r = ie(t, n);
		if (r >= 0) {
			for (var i = t.length - 1; r <= i;) t[r] = t[++r];
			if (t.length = i, e) {
				var a = e.ownerDocument;
				a && pe(a, e, n), n.ownerElement = null;
			}
		}
	}
	re.prototype = {
		length: 0,
		item: z.prototype.item,
		getNamedItem: function(e) {
			this._ownerElement && this._ownerElement._isInHTMLDocumentAndNamespace() && (e = e.toLowerCase());
			for (var t = 0; t < this.length;) {
				var n = this[t];
				if (n.nodeName === e) return n;
				t++;
			}
			return null;
		},
		setNamedItem: function(e) {
			var t = e.ownerElement;
			if (t && t !== this._ownerElement) throw new f(f.INUSE_ATTRIBUTE_ERR);
			var n = this.getNamedItemNS(e.namespaceURI, e.localName);
			return n === e ? e : (ae(this._ownerElement, this, e, n), n);
		},
		setNamedItemNS: function(e) {
			return this.setNamedItem(e);
		},
		removeNamedItem: function(e) {
			var t = this.getNamedItem(e);
			if (!t) throw new f(f.NOT_FOUND_ERR, e);
			return oe(this._ownerElement, this, t), t;
		},
		removeNamedItemNS: function(e, t) {
			var n = this.getNamedItemNS(e, t);
			if (!n) throw new f(f.NOT_FOUND_ERR, e ? e + " : " + t : t);
			return oe(this._ownerElement, this, n), n;
		},
		getNamedItemNS: function(e, t) {
			e || (e = null);
			for (var n = 0; n < this.length;) {
				var r = this[n];
				if (r.localName === t && r.namespaceURI === e) return r;
				n++;
			}
			return null;
		}
	}, re.prototype[Symbol.iterator] = function() {
		var e = this, t = 0;
		return {
			next: function() {
				return t < e.length ? {
					value: e[t++],
					done: !1
				} : { done: !0 };
			},
			return: function() {
				return { done: !0 };
			}
		};
	};
	function se() {}
	se.prototype = {
		hasFeature: function(e, t) {
			return !0;
		},
		createDocument: function(e, t, n) {
			var r = c.XML_APPLICATION;
			e === l.HTML ? r = c.XML_XHTML_APPLICATION : e === l.SVG && (r = c.XML_SVG_IMAGE);
			var i = new de(u, { contentType: r });
			if (i.implementation = this, i.childNodes = new z(), i.doctype = n || null, n && i.appendChild(n), t) {
				var a = i.createElementNS(e, t);
				i.appendChild(a);
			}
			return i;
		},
		createDocumentType: function(e, t, n, r) {
			x(e);
			var i = new Me(u);
			return i.name = e, i.nodeName = e, i.publicId = t || "", i.systemId = n || "", i.internalSubset = r || "", i.childNodes = new z(), i;
		},
		createHTMLDocument: function(e) {
			var t = new de(u, { contentType: c.HTML });
			if (t.implementation = this, t.childNodes = new z(), e !== !1) {
				t.doctype = this.createDocumentType("html"), t.doctype.ownerDocument = t, t.appendChild(t.doctype);
				var n = t.createElement("html");
				t.appendChild(n);
				var r = t.createElement("head");
				if (n.appendChild(r), typeof e == "string") {
					var i = t.createElement("title");
					i.appendChild(t.createTextNode(e)), r.appendChild(i);
				}
				n.appendChild(t.createElement("body"));
			}
			return t;
		}
	};
	function V(e) {
		h(e);
	}
	V.prototype = {
		firstChild: null,
		lastChild: null,
		previousSibling: null,
		nextSibling: null,
		parentNode: null,
		get parentElement() {
			return this.parentNode && this.parentNode.nodeType === this.ELEMENT_NODE ? this.parentNode : null;
		},
		childNodes: null,
		ownerDocument: null,
		nodeValue: null,
		namespaceURI: null,
		prefix: null,
		localName: null,
		baseURI: "about:blank",
		get isConnected() {
			var e = this.getRootNode();
			return e && e.nodeType === e.DOCUMENT_NODE;
		},
		contains: function(e) {
			if (!e) return !1;
			var t = e;
			do {
				if (this === t) return !0;
				t = t.parentNode;
			} while (t);
			return !1;
		},
		getRootNode: function(e) {
			var t = this;
			do {
				if (!t.parentNode) return t;
				t = t.parentNode;
			} while (t);
		},
		isEqualNode: function(e) {
			if (!e) return !1;
			for (var t = [{
				node: this,
				other: e
			}]; t.length > 0;) {
				var n = t.pop(), r = n.node, i = n.other;
				if (r.nodeType !== i.nodeType) return !1;
				switch (r.nodeType) {
					case r.DOCUMENT_TYPE_NODE:
						if (r.name !== i.name || r.publicId !== i.publicId || r.systemId !== i.systemId) return !1;
						break;
					case r.ELEMENT_NODE:
						if (r.namespaceURI !== i.namespaceURI || r.prefix !== i.prefix || r.localName !== i.localName || r.attributes.length !== i.attributes.length) return !1;
						for (var a = 0; a < r.attributes.length; a++) {
							var o = r.attributes.item(a), s = i.getAttributeNodeNS(o.namespaceURI, o.localName);
							if (!s) return !1;
							t.push({
								node: o,
								other: s
							});
						}
						break;
					case r.ATTRIBUTE_NODE:
						if (r.namespaceURI !== i.namespaceURI || r.localName !== i.localName || r.value !== i.value) return !1;
						break;
					case r.PROCESSING_INSTRUCTION_NODE:
						if (r.target !== i.target || r.data !== i.data) return !1;
						break;
					case r.TEXT_NODE:
					case r.CDATA_SECTION_NODE:
					case r.COMMENT_NODE:
						if (r.data !== i.data) return !1;
						break;
				}
				if (r.childNodes.length !== i.childNodes.length) return !1;
				for (var a = r.childNodes.length - 1; a >= 0; a--) t.push({
					node: r.childNodes[a],
					other: i.childNodes[a]
				});
			}
			return !0;
		},
		isSameNode: function(e) {
			return this === e;
		},
		insertBefore: function(e, t) {
			return Ee(this, e, t);
		},
		replaceChild: function(e, t) {
			Ee(this, e, t, Te), t && this.removeChild(t);
		},
		removeChild: function(e) {
			return he(this, e);
		},
		appendChild: function(e) {
			return this.insertBefore(e, null);
		},
		hasChildNodes: function() {
			return this.firstChild != null;
		},
		cloneNode: function(e) {
			return We(this.ownerDocument || this, this, e);
		},
		normalize: function() {
			ue(this, null, { enter: function(e) {
				for (var t = e.firstChild; t;) {
					var n = t.nextSibling;
					n !== null && n.nodeType === O && t.nodeType === O ? (e.removeChild(n), t.appendData(n.data)) : t = n;
				}
				return !0;
			} });
		},
		isSupported: function(e, t) {
			return this.ownerDocument.implementation.hasFeature(e, t);
		},
		lookupPrefix: function(e) {
			for (var t = this; t;) {
				var n = t._nsMap;
				if (n) {
					for (var r in n) if (i(n, r) && n[r] === e) return r;
				}
				t = t.nodeType == D ? t.ownerDocument : t.parentNode;
			}
			return null;
		},
		lookupNamespaceURI: function(e) {
			for (var t = this; t;) {
				var n = t._nsMap;
				if (n && i(n, e)) return n[e];
				t = t.nodeType == D ? t.ownerDocument : t.parentNode;
			}
			return null;
		},
		isDefaultNamespace: function(e) {
			return this.lookupPrefix(e) == null;
		},
		compareDocumentPosition: function(e) {
			if (this === e) return 0;
			var t = e, n = this, r = null, i = null;
			if (t instanceof De && (r = t, t = r.ownerElement), n instanceof De && (i = n, n = i.ownerElement, r && t && n === t)) for (var a = 0, o; o = n.attributes[a]; a++) {
				if (o === r) return I.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + I.DOCUMENT_POSITION_PRECEDING;
				if (o === i) return I.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + I.DOCUMENT_POSITION_FOLLOWING;
			}
			if (!t || !n || n.ownerDocument !== t.ownerDocument) return I.DOCUMENT_POSITION_DISCONNECTED + I.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC + (R(n.ownerDocument) > R(t.ownerDocument) ? I.DOCUMENT_POSITION_FOLLOWING : I.DOCUMENT_POSITION_PRECEDING);
			if (i && t === n) return I.DOCUMENT_POSITION_CONTAINS + I.DOCUMENT_POSITION_PRECEDING;
			if (r && t === n) return I.DOCUMENT_POSITION_CONTAINED_BY + I.DOCUMENT_POSITION_FOLLOWING;
			for (var s = [], c = t.parentNode; c;) {
				if (!i && c === n) return I.DOCUMENT_POSITION_CONTAINED_BY + I.DOCUMENT_POSITION_FOLLOWING;
				s.push(c), c = c.parentNode;
			}
			s.reverse();
			for (var l = [], u = n.parentNode; u;) {
				if (!r && u === t) return I.DOCUMENT_POSITION_CONTAINS + I.DOCUMENT_POSITION_PRECEDING;
				l.push(u), u = u.parentNode;
			}
			l.reverse();
			var d = L(s, l);
			for (var f in d.childNodes) {
				var p = d.childNodes[f];
				if (p === n) return I.DOCUMENT_POSITION_FOLLOWING;
				if (p === t) return I.DOCUMENT_POSITION_PRECEDING;
				if (l.indexOf(p) >= 0) return I.DOCUMENT_POSITION_FOLLOWING;
				if (s.indexOf(p) >= 0) return I.DOCUMENT_POSITION_PRECEDING;
			}
			return 0;
		}
	};
	function ce(e) {
		return e == "<" && "&lt;" || e == ">" && "&gt;" || e == "&" && "&amp;" || e == "\"" && "&quot;" || "&#" + e.charCodeAt() + ";";
	}
	C(T, V), C(T, V.prototype), C(I, V), C(I, V.prototype);
	function le(e, t) {
		ue(e, null, { enter: function(e) {
			return t(e) ? ue.STOP : !0;
		} });
	}
	function ue(e, t, n) {
		for (var r = [{
			node: e,
			context: t,
			phase: ue.ENTER
		}]; r.length > 0;) {
			var i = r.pop();
			if (i.phase === ue.ENTER) {
				var a = n.enter(i.node, i.context);
				if (a === ue.STOP) return ue.STOP;
				if (r.push({
					node: i.node,
					context: a,
					phase: ue.EXIT
				}), a == null) continue;
				for (var o = i.node.lastChild; o;) r.push({
					node: o,
					context: a,
					phase: ue.ENTER
				}), o = o.previousSibling;
			} else n.exit && n.exit(i.node, i.context);
		}
	}
	ue.STOP = Symbol("walkDOM.STOP"), ue.ENTER = 0, ue.EXIT = 1;
	function de(e, t) {
		h(e);
		var n = t || {};
		this.ownerDocument = this, this.contentType = n.contentType || c.XML_APPLICATION, this.type = a(this.contentType) ? "html" : "xml";
	}
	function fe(e, t, n) {
		e && e._inc++, n.namespaceURI === l.XMLNS && (t._nsMap[n.prefix ? n.localName : ""] = n.value);
	}
	function pe(e, t, n, r) {
		e && e._inc++, n.namespaceURI === l.XMLNS && delete t._nsMap[n.prefix ? n.localName : ""];
	}
	function me(e, t, n) {
		if (e && e._inc) {
			e._inc++;
			var r = t.childNodes;
			if (n && !n.nextSibling) r[r.length++] = n;
			else {
				for (var i = t.firstChild, a = 0; i;) r[a++] = i, i = i.nextSibling;
				r.length = a, delete r[r.length];
			}
		}
	}
	function he(e, t) {
		if (e !== t.parentNode) throw new f(f.NOT_FOUND_ERR, "child's parent is not parent");
		var n = t.previousSibling, r = t.nextSibling;
		return n ? n.nextSibling = r : e.firstChild = r, r ? r.previousSibling = n : e.lastChild = n, me(e.ownerDocument, e), t.parentNode = null, t.previousSibling = null, t.nextSibling = null, t;
	}
	function ge(e) {
		return e && (e.nodeType === V.DOCUMENT_NODE || e.nodeType === V.DOCUMENT_FRAGMENT_NODE || e.nodeType === V.ELEMENT_NODE);
	}
	function _e(e) {
		return e && (e.nodeType === V.CDATA_SECTION_NODE || e.nodeType === V.COMMENT_NODE || e.nodeType === V.DOCUMENT_FRAGMENT_NODE || e.nodeType === V.DOCUMENT_TYPE_NODE || e.nodeType === V.ELEMENT_NODE || e.nodeType === V.PROCESSING_INSTRUCTION_NODE || e.nodeType === V.TEXT_NODE);
	}
	function ve(e) {
		return e && e.nodeType === V.DOCUMENT_TYPE_NODE;
	}
	function ye(e) {
		return e && e.nodeType === V.ELEMENT_NODE;
	}
	function be(e) {
		return e && e.nodeType === V.TEXT_NODE;
	}
	function xe(e, t) {
		var r = e.childNodes || [];
		if (n(r, ye) || ve(t)) return !1;
		var i = n(r, ve);
		return !(t && i && r.indexOf(i) > r.indexOf(t));
	}
	function Se(e, t) {
		var r = e.childNodes || [];
		function i(e) {
			return ye(e) && e !== t;
		}
		if (n(r, i)) return !1;
		var a = n(r, ve);
		return !(t && a && r.indexOf(a) > r.indexOf(t));
	}
	function Ce(e, t, n) {
		if (!ge(e)) throw new f(f.HIERARCHY_REQUEST_ERR, "Unexpected parent node type " + e.nodeType);
		if (n && n.parentNode !== e) throw new f(f.NOT_FOUND_ERR, "child not in parent");
		if (!_e(t) || ve(t) && e.nodeType !== V.DOCUMENT_NODE) throw new f(f.HIERARCHY_REQUEST_ERR, "Unexpected node type " + t.nodeType + " for parent node type " + e.nodeType);
	}
	function we(e, t, r) {
		var i = e.childNodes || [], a = t.childNodes || [];
		if (t.nodeType === V.DOCUMENT_FRAGMENT_NODE) {
			var o = a.filter(ye);
			if (o.length > 1 || n(a, be)) throw new f(f.HIERARCHY_REQUEST_ERR, "More than one element or text in fragment");
			if (o.length === 1 && !xe(e, r)) throw new f(f.HIERARCHY_REQUEST_ERR, "Element in fragment can not be inserted before doctype");
		}
		if (ye(t) && !xe(e, r)) throw new f(f.HIERARCHY_REQUEST_ERR, "Only one element can be added and only after doctype");
		if (ve(t)) {
			if (n(i, ve)) throw new f(f.HIERARCHY_REQUEST_ERR, "Only one doctype is allowed");
			var s = n(i, ye);
			if (r && i.indexOf(s) < i.indexOf(r)) throw new f(f.HIERARCHY_REQUEST_ERR, "Doctype can only be inserted before an element");
			if (!r && s) throw new f(f.HIERARCHY_REQUEST_ERR, "Doctype can not be appended since element is present");
		}
	}
	function Te(e, t, r) {
		var i = e.childNodes || [], a = t.childNodes || [];
		if (t.nodeType === V.DOCUMENT_FRAGMENT_NODE) {
			var o = a.filter(ye);
			if (o.length > 1 || n(a, be)) throw new f(f.HIERARCHY_REQUEST_ERR, "More than one element or text in fragment");
			if (o.length === 1 && !Se(e, r)) throw new f(f.HIERARCHY_REQUEST_ERR, "Element in fragment can not be inserted before doctype");
		}
		if (ye(t) && !Se(e, r)) throw new f(f.HIERARCHY_REQUEST_ERR, "Only one element can be added and only after doctype");
		if (ve(t)) {
			function e(e) {
				return ve(e) && e !== r;
			}
			if (n(i, e)) throw new f(f.HIERARCHY_REQUEST_ERR, "Only one doctype is allowed");
			var s = n(i, ye);
			if (r && i.indexOf(s) < i.indexOf(r)) throw new f(f.HIERARCHY_REQUEST_ERR, "Doctype can only be inserted before an element");
		}
	}
	function Ee(e, t, n, r) {
		Ce(e, t, n), e.nodeType === V.DOCUMENT_NODE && (r || we)(e, t, n);
		var i = t.parentNode;
		if (i && i.removeChild(t), t.nodeType === P) {
			var a = t.firstChild;
			if (a == null) return t;
			var o = t.lastChild;
		} else a = o = t;
		var s = n ? n.previousSibling : e.lastChild;
		a.previousSibling = s, o.nextSibling = n, s ? s.nextSibling = a : e.firstChild = a, n == null ? e.lastChild = o : n.previousSibling = o;
		do
			a.parentNode = e;
		while (a !== o && (a = a.nextSibling));
		return me(e.ownerDocument || e, e, t), t.nodeType == P && (t.firstChild = t.lastChild = null), t;
	}
	de.prototype = {
		implementation: null,
		nodeName: "#document",
		nodeType: te,
		doctype: null,
		documentElement: null,
		_inc: 1,
		insertBefore: function(e, t) {
			if (e.nodeType === P) {
				for (var n = e.firstChild; n;) {
					var r = n.nextSibling;
					this.insertBefore(n, t), n = r;
				}
				return e;
			}
			return Ee(this, e, t), e.ownerDocument = this, this.documentElement === null && e.nodeType === E && (this.documentElement = e), e;
		},
		removeChild: function(e) {
			var t = he(this, e);
			return t === this.documentElement && (this.documentElement = null), t;
		},
		replaceChild: function(e, t) {
			Ee(this, e, t, Te), e.ownerDocument = this, t && this.removeChild(t), ye(e) && (this.documentElement = e);
		},
		importNode: function(e, t) {
			return Ue(this, e, t);
		},
		getElementById: function(e) {
			var t = null;
			return le(this.documentElement, function(n) {
				if (n.nodeType == E && n.getAttribute("id") == e) return t = n, !0;
			}), t;
		},
		createElement: function(e) {
			var t = new H(u);
			t.ownerDocument = this, this.type === "html" && (e = e.toLowerCase()), r(this.contentType) && (t.namespaceURI = l.HTML), t.nodeName = e, t.tagName = e, t.localName = e, t.childNodes = new z();
			var n = t.attributes = new re();
			return n._ownerElement = t, t;
		},
		createDocumentFragment: function() {
			var e = new Ie(u);
			return e.ownerDocument = this, e.childNodes = new z(), e;
		},
		createTextNode: function(e) {
			var t = new ke(u);
			return t.ownerDocument = this, t.childNodes = new z(), t.appendData(e), t;
		},
		createComment: function(e) {
			var t = new Ae(u);
			return t.ownerDocument = this, t.childNodes = new z(), t.appendData(e), t;
		},
		createCDATASection: function(e) {
			if (e.indexOf("]]>") !== -1) throw new f(f.INVALID_CHARACTER_ERR, "data contains \"]]>\"");
			var t = new je(u);
			return t.ownerDocument = this, t.childNodes = new z(), t.appendData(e), t;
		},
		createProcessingInstruction: function(e, t) {
			var n = new Le(u);
			return n.ownerDocument = this, n.childNodes = new z(), n.nodeName = n.target = e, n.nodeValue = n.data = t, n;
		},
		createAttribute: function(e) {
			if (!m.QName_exact.test(e)) throw new f(f.INVALID_CHARACTER_ERR, "invalid character in name \"" + e + "\"");
			return this.type === "html" && (e = e.toLowerCase()), this._createAttribute(e);
		},
		_createAttribute: function(e) {
			var t = new De(u);
			return t.ownerDocument = this, t.childNodes = new z(), t.name = e, t.nodeName = e, t.localName = e, t.specified = !0, t;
		},
		createEntityReference: function(e) {
			if (!m.Name.test(e)) throw new f(f.INVALID_CHARACTER_ERR, "not a valid xml name \"" + e + "\"");
			if (this.type === "html") throw new f("document is an html document", p.NotSupportedError);
			var t = new Fe(u);
			return t.ownerDocument = this, t.childNodes = new z(), t.nodeName = e, t;
		},
		createElementNS: function(e, t) {
			var n = S(e, t), r = new H(u), i = r.attributes = new re();
			return r.childNodes = new z(), r.ownerDocument = this, r.nodeName = t, r.tagName = t, r.namespaceURI = n[0], r.prefix = n[1], r.localName = n[2], i._ownerElement = r, r;
		},
		createAttributeNS: function(e, t) {
			var n = S(e, t), r = new De(u);
			return r.ownerDocument = this, r.childNodes = new z(), r.nodeName = t, r.name = t, r.specified = !0, r.namespaceURI = n[0], r.prefix = n[1], r.localName = n[2], r;
		}
	}, w(de, V);
	function H(e) {
		h(e), this._nsMap = Object.create(null);
	}
	H.prototype = {
		nodeType: E,
		attributes: null,
		getQualifiedName: function() {
			return this.prefix ? this.prefix + ":" + this.localName : this.localName;
		},
		_isInHTMLDocumentAndNamespace: function() {
			return this.ownerDocument.type === "html" && this.namespaceURI === l.HTML;
		},
		hasAttributes: function() {
			return !!(this.attributes && this.attributes.length);
		},
		hasAttribute: function(e) {
			return !!this.getAttributeNode(e);
		},
		getAttribute: function(e) {
			var t = this.getAttributeNode(e);
			return t ? t.value : null;
		},
		getAttributeNode: function(e) {
			return this._isInHTMLDocumentAndNamespace() && (e = e.toLowerCase()), this.attributes.getNamedItem(e);
		},
		setAttribute: function(e, t) {
			this._isInHTMLDocumentAndNamespace() && (e = e.toLowerCase());
			var n = this.getAttributeNode(e);
			n ? n.value = n.nodeValue = "" + t : (n = this.ownerDocument._createAttribute(e), n.value = n.nodeValue = "" + t, this.setAttributeNode(n));
		},
		removeAttribute: function(e) {
			var t = this.getAttributeNode(e);
			t && this.removeAttributeNode(t);
		},
		setAttributeNode: function(e) {
			return this.attributes.setNamedItem(e);
		},
		setAttributeNodeNS: function(e) {
			return this.attributes.setNamedItemNS(e);
		},
		removeAttributeNode: function(e) {
			return this.attributes.removeNamedItem(e.nodeName);
		},
		removeAttributeNS: function(e, t) {
			var n = this.getAttributeNodeNS(e, t);
			n && this.removeAttributeNode(n);
		},
		hasAttributeNS: function(e, t) {
			return this.getAttributeNodeNS(e, t) != null;
		},
		getAttributeNS: function(e, t) {
			var n = this.getAttributeNodeNS(e, t);
			return n ? n.value : null;
		},
		setAttributeNS: function(e, t, n) {
			var r = S(e, t)[2], i = this.getAttributeNodeNS(e, r);
			i ? i.value = i.nodeValue = "" + n : (i = this.ownerDocument.createAttributeNS(e, t), i.value = i.nodeValue = "" + n, this.setAttributeNode(i));
		},
		getAttributeNodeNS: function(e, t) {
			return this.attributes.getNamedItemNS(e, t);
		},
		getElementsByClassName: function(e) {
			var t = y(e);
			return new ne(this, function(n) {
				var r = [];
				return t.length > 0 && le(n, function(i) {
					if (i !== n && i.nodeType === E) {
						var a = i.getAttribute("class");
						if (a) {
							var o = e === a;
							if (!o) {
								var s = y(a);
								o = t.every(b(s));
							}
							o && r.push(i);
						}
					}
				}), r;
			});
		},
		getElementsByTagName: function(e) {
			var t = (this.nodeType === te ? this : this.ownerDocument).type === "html", n = e.toLowerCase();
			return new ne(this, function(r) {
				var i = [];
				return le(r, function(a) {
					a === r || a.nodeType !== E || (e === "*" || a.getQualifiedName() === (t && a.namespaceURI === l.HTML ? n : e)) && i.push(a);
				}), i;
			});
		},
		getElementsByTagNameNS: function(e, t) {
			return new ne(this, function(n) {
				var r = [];
				return le(n, function(i) {
					i !== n && i.nodeType === E && (e === "*" || i.namespaceURI === e) && (t === "*" || i.localName == t) && r.push(i);
				}), r;
			});
		}
	}, de.prototype.getElementsByClassName = H.prototype.getElementsByClassName, de.prototype.getElementsByTagName = H.prototype.getElementsByTagName, de.prototype.getElementsByTagNameNS = H.prototype.getElementsByTagNameNS, w(H, V);
	function De(e) {
		h(e), this.namespaceURI = null, this.prefix = null, this.ownerElement = null;
	}
	De.prototype.nodeType = D, w(De, V);
	function Oe(e) {
		h(e);
	}
	Oe.prototype = {
		data: "",
		substringData: function(e, t) {
			return this.data.substring(e, e + t);
		},
		appendData: function(e) {
			e = this.data + e, this.nodeValue = this.data = e, this.length = e.length;
		},
		insertData: function(e, t) {
			this.replaceData(e, 0, t);
		},
		deleteData: function(e, t) {
			this.replaceData(e, t, "");
		},
		replaceData: function(e, t, n) {
			var r = this.data.substring(0, e), i = this.data.substring(e + t);
			n = r + n + i, this.nodeValue = this.data = n, this.length = n.length;
		}
	}, w(Oe, V);
	function ke(e) {
		h(e);
	}
	ke.prototype = {
		nodeName: "#text",
		nodeType: O,
		splitText: function(e) {
			var t = this.data, n = t.substring(e);
			t = t.substring(0, e), this.data = this.nodeValue = t, this.length = t.length;
			var r = this.ownerDocument.createTextNode(n);
			return this.parentNode && this.parentNode.insertBefore(r, this.nextSibling), r;
		}
	}, w(ke, Oe);
	function Ae(e) {
		h(e);
	}
	Ae.prototype = {
		nodeName: "#comment",
		nodeType: ee
	}, w(Ae, Oe);
	function je(e) {
		h(e);
	}
	je.prototype = {
		nodeName: "#cdata-section",
		nodeType: k
	}, w(je, ke);
	function Me(e) {
		h(e);
	}
	Me.prototype.nodeType = N, w(Me, V);
	function Ne(e) {
		h(e);
	}
	Ne.prototype.nodeType = F, w(Ne, V);
	function Pe(e) {
		h(e);
	}
	Pe.prototype.nodeType = j, w(Pe, V);
	function Fe(e) {
		h(e);
	}
	Fe.prototype.nodeType = A, w(Fe, V);
	function Ie(e) {
		h(e);
	}
	Ie.prototype.nodeName = "#document-fragment", Ie.prototype.nodeType = P, w(Ie, V);
	function Le(e) {
		h(e);
	}
	Le.prototype.nodeType = M, w(Le, Oe);
	function Re() {}
	Re.prototype.serializeToString = function(e, t) {
		return ze.call(e, t);
	}, V.prototype.toString = ze;
	function ze(e) {
		var t = typeof e == "function" ? {
			requireWellFormed: !1,
			splitCDATASections: !0,
			nodeFilter: e
		} : e == null ? {
			requireWellFormed: !1,
			splitCDATASections: !0,
			nodeFilter: null
		} : {
			requireWellFormed: !!e.requireWellFormed,
			splitCDATASections: e.splitCDATASections !== !1,
			nodeFilter: e.nodeFilter || null
		}, n = [], r = this.nodeType === te && this.documentElement || this, i = r.prefix, a = r.namespaceURI;
		if (a && i == null) {
			var i = r.lookupPrefix(a);
			if (i == null) var o = [{
				namespace: a,
				prefix: null
			}];
		}
		return He(this, n, o, t), n.join("");
	}
	function Be(e, t, n) {
		var r = e.prefix || "", i = e.namespaceURI;
		if (!i || r === "xml" && i === l.XML || i === l.XMLNS) return !1;
		for (var a = n.length; a--;) {
			var o = n[a];
			if (o.prefix === r) return o.namespace !== i;
		}
		return !0;
	}
	function Ve(e, t, n) {
		e.push(" ", t, "=\"", n.replace(/[<>&"\t\n\r]/g, ce), "\"");
	}
	function He(e, t, n, r) {
		n || (n = []);
		var i = r.nodeFilter, a = r.requireWellFormed, c = r.splitCDATASections, u = (e.nodeType === te ? e : e.ownerDocument).type === "html";
		ue(e, { ns: n }, {
			enter: function(e, n) {
				var d = n.ns;
				if (i) if (e = i(e), e) {
					if (typeof e == "string") return t.push(e), null;
				} else return null;
				switch (e.nodeType) {
					case E:
						var h = e.attributes, g = h.length, _ = e.tagName, v = _;
						if (!u && !e.prefix && e.namespaceURI) {
							for (var y, b = 0; b < h.length; b++) if (h.item(b).name === "xmlns") {
								y = h.item(b).value;
								break;
							}
							if (!y) for (var x = d.length - 1; x >= 0; x--) {
								var S = d[x];
								if (S.prefix === "" && S.namespace === e.namespaceURI) {
									y = S.namespace;
									break;
								}
							}
							if (y !== e.namespaceURI) for (var x = d.length - 1; x >= 0; x--) {
								var S = d[x];
								if (S.namespace === e.namespaceURI) {
									S.prefix && (v = S.prefix + ":" + _);
									break;
								}
							}
						}
						t.push("<", v);
						for (var C = d.slice(), w = 0; w < g; w++) {
							var T = h.item(w);
							T.prefix == "xmlns" ? C.push({
								prefix: T.localName,
								namespace: T.value
							}) : T.nodeName == "xmlns" && C.push({
								prefix: "",
								namespace: T.value
							});
						}
						for (var w = 0; w < g; w++) {
							var T = h.item(w);
							if (Be(T, u, C)) {
								var j = T.prefix || "", F = T.namespaceURI;
								Ve(t, j ? "xmlns:" + j : "xmlns", F), C.push({
									prefix: j,
									namespace: F
								});
							}
							var I = i ? i(T) : T;
							I && (typeof I == "string" ? t.push(I) : Ve(t, I.name, I.value));
						}
						if (_ === v && Be(e, u, C)) {
							var L = e.prefix || "", F = e.namespaceURI;
							Ve(t, L ? "xmlns:" + L : "xmlns", F), C.push({
								prefix: L,
								namespace: F
							});
						}
						var R = !e.firstChild;
						if (R && (u || e.namespaceURI === l.HTML) && (R = s(_)), R) return t.push("/>"), null;
						if (t.push(">"), u && o(_)) {
							for (var z = e.firstChild; z;) z.data ? t.push(z.data) : He(z, t, C.slice(), r), z = z.nextSibling;
							return t.push("</", v, ">"), null;
						}
						return {
							ns: C,
							tag: v
						};
					case te:
					case P:
						if (a && e.nodeType === te && e.documentElement == null) throw new f("The Document has no documentElement", p.InvalidStateError);
						return { ns: d };
					case D: return Ve(t, e.name, e.value), null;
					case O:
						if (a && m.InvalidChar.test(e.data)) throw new f("The Text node data contains characters outside the XML Char production", p.InvalidStateError);
						return t.push(e.data.replace(/[<&>]/g, ce)), null;
					case k:
						if (a && e.data.indexOf("]]>") !== -1) throw new f("The CDATASection data contains \"]]>\"", p.InvalidStateError);
						return c ? t.push(m.CDATA_START, e.data.replace(/]]>/g, "]]]]><![CDATA[>"), m.CDATA_END) : t.push(m.CDATA_START, e.data, m.CDATA_END), null;
					case ee:
						if (a) {
							if (m.InvalidChar.test(e.data)) throw new f("The comment node data contains characters outside the XML Char production", p.InvalidStateError);
							if (e.data.indexOf("--") !== -1 || e.data[e.data.length - 1] === "-") throw new f("The comment node data contains \"--\" or ends with \"-\"", p.InvalidStateError);
						}
						return t.push(m.COMMENT_START, e.data, m.COMMENT_END), null;
					case N:
						var ne = e.publicId, B = e.systemId;
						if (a) {
							if (ne && !m.PubidLiteral_match.test(ne)) throw new f("DocumentType publicId is not a valid PubidLiteral", p.InvalidStateError);
							if (B && B !== "." && !m.SystemLiteral_match.test(B)) throw new f("DocumentType systemId is not a valid SystemLiteral", p.InvalidStateError);
							if (e.internalSubset && e.internalSubset.indexOf("]>") !== -1) throw new f("DocumentType internalSubset contains \"]>\"", p.InvalidStateError);
						}
						return t.push(m.DOCTYPE_DECL_START, " ", e.name), ne ? (t.push(" ", m.PUBLIC, " ", ne), B && B !== "." && t.push(" ", B)) : B && B !== "." && t.push(" ", m.SYSTEM, " ", B), e.internalSubset && t.push(" [", e.internalSubset, "]"), t.push(">"), null;
					case M:
						if (a) {
							if (e.target.indexOf(":") !== -1 || e.target.toLowerCase() === "xml") throw new f("The ProcessingInstruction target is not well-formed", p.InvalidStateError);
							if (m.InvalidChar.test(e.data)) throw new f("The ProcessingInstruction data contains characters outside the XML Char production", p.InvalidStateError);
							if (e.data.indexOf("?>") !== -1) throw new f("The ProcessingInstruction data contains \"?>\"", p.InvalidStateError);
						}
						return t.push("<?", e.target, " ", e.data, "?>"), null;
					case A: return t.push("&", e.nodeName, ";"), null;
					default: return t.push("??", e.nodeName), null;
				}
			},
			exit: function(e, n) {
				n && n.tag && t.push("</", n.tag, ">");
			}
		});
	}
	function Ue(e, t, n) {
		var r;
		return ue(t, null, { enter: function(t, i) {
			var a = t.cloneNode(!1);
			return a.ownerDocument = e, a.parentNode = null, i === null ? r = a : i.appendChild(a), t.nodeType === D || n ? a : null;
		} }), r;
	}
	function We(e, t, n) {
		var r;
		return ue(t, null, { enter: function(t, a) {
			var o = new t.constructor(u);
			for (var s in t) if (i(t, s)) {
				var c = t[s];
				typeof c != "object" && c != o[s] && (o[s] = c);
			}
			t.childNodes && (o.childNodes = new z()), o.ownerDocument = e;
			var l = n;
			switch (o.nodeType) {
				case E:
					var d = t.attributes, f = o.attributes = new re(), p = d.length;
					f._ownerElement = o;
					for (var m = 0; m < p; m++) o.setAttributeNode(We(e, d.item(m), !0));
					break;
				case D: l = !0;
			}
			return a === null ? r = o : a.appendChild(o), l ? o : null;
		} }), r;
	}
	function Ge(e, t, n) {
		e[t] = n;
	}
	function Ke(e) {
		for (var t = [], n = e.firstChild; n;) n.nodeType === E && t.push(n), n = n.nextSibling;
		return t;
	}
	try {
		Object.defineProperty && (Object.defineProperty(ne.prototype, "length", { get: function() {
			return B(this), this.$$length;
		} }), Object.defineProperty(V.prototype, "textContent", {
			get: function() {
				if (this.nodeType === E || this.nodeType === P) {
					var e = [];
					return ue(this, null, { enter: function(t) {
						if (t.nodeType === E || t.nodeType === P) return !0;
						if (t.nodeType === M || t.nodeType === ee) return null;
						e.push(t.nodeValue);
					} }), e.join("");
				}
				return this.nodeValue;
			},
			set: function(e) {
				switch (this.nodeType) {
					case E:
					case P:
						for (; this.firstChild;) this.removeChild(this.firstChild);
						(e || String(e)) && this.appendChild(this.ownerDocument.createTextNode(e));
						break;
					default: this.data = e, this.value = e, this.nodeValue = e;
				}
			}
		}), Object.defineProperty(H.prototype, "children", { get: function() {
			return new ne(this, Ke);
		} }), Object.defineProperty(de.prototype, "children", { get: function() {
			return new ne(this, Ke);
		} }), Object.defineProperty(Ie.prototype, "children", { get: function() {
			return new ne(this, Ke);
		} }), Ge = function(e, t, n) {
			e["$$" + t] = n;
		});
	} catch {}
	e._updateLiveList = B, e.Attr = De, e.CDATASection = je, e.CharacterData = Oe, e.Comment = Ae, e.Document = de, e.DocumentFragment = Ie, e.DocumentType = Me, e.DOMImplementation = se, e.Element = H, e.Entity = Pe, e.EntityReference = Fe, e.LiveNodeList = ne, e.NamedNodeMap = re, e.Node = V, e.NodeList = z, e.Notation = Ne, e.Text = ke, e.ProcessingInstruction = Le, e.walkDOM = ue, e.XMLSerializer = Re;
})), Vt = /* @__PURE__ */ s(((e) => {
	var t = Lt().freeze;
	e.XML_ENTITIES = t({
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		quot: "\""
	}), e.HTML_ENTITIES = t({
		Aacute: "Á",
		aacute: "á",
		Abreve: "Ă",
		abreve: "ă",
		ac: "∾",
		acd: "∿",
		acE: "∾̳",
		Acirc: "Â",
		acirc: "â",
		acute: "´",
		Acy: "А",
		acy: "а",
		AElig: "Æ",
		aelig: "æ",
		af: "⁡",
		Afr: "𝔄",
		afr: "𝔞",
		Agrave: "À",
		agrave: "à",
		alefsym: "ℵ",
		aleph: "ℵ",
		Alpha: "Α",
		alpha: "α",
		Amacr: "Ā",
		amacr: "ā",
		amalg: "⨿",
		AMP: "&",
		amp: "&",
		And: "⩓",
		and: "∧",
		andand: "⩕",
		andd: "⩜",
		andslope: "⩘",
		andv: "⩚",
		ang: "∠",
		ange: "⦤",
		angle: "∠",
		angmsd: "∡",
		angmsdaa: "⦨",
		angmsdab: "⦩",
		angmsdac: "⦪",
		angmsdad: "⦫",
		angmsdae: "⦬",
		angmsdaf: "⦭",
		angmsdag: "⦮",
		angmsdah: "⦯",
		angrt: "∟",
		angrtvb: "⊾",
		angrtvbd: "⦝",
		angsph: "∢",
		angst: "Å",
		angzarr: "⍼",
		Aogon: "Ą",
		aogon: "ą",
		Aopf: "𝔸",
		aopf: "𝕒",
		ap: "≈",
		apacir: "⩯",
		apE: "⩰",
		ape: "≊",
		apid: "≋",
		apos: "'",
		ApplyFunction: "⁡",
		approx: "≈",
		approxeq: "≊",
		Aring: "Å",
		aring: "å",
		Ascr: "𝒜",
		ascr: "𝒶",
		Assign: "≔",
		ast: "*",
		asymp: "≈",
		asympeq: "≍",
		Atilde: "Ã",
		atilde: "ã",
		Auml: "Ä",
		auml: "ä",
		awconint: "∳",
		awint: "⨑",
		backcong: "≌",
		backepsilon: "϶",
		backprime: "‵",
		backsim: "∽",
		backsimeq: "⋍",
		Backslash: "∖",
		Barv: "⫧",
		barvee: "⊽",
		Barwed: "⌆",
		barwed: "⌅",
		barwedge: "⌅",
		bbrk: "⎵",
		bbrktbrk: "⎶",
		bcong: "≌",
		Bcy: "Б",
		bcy: "б",
		bdquo: "„",
		becaus: "∵",
		Because: "∵",
		because: "∵",
		bemptyv: "⦰",
		bepsi: "϶",
		bernou: "ℬ",
		Bernoullis: "ℬ",
		Beta: "Β",
		beta: "β",
		beth: "ℶ",
		between: "≬",
		Bfr: "𝔅",
		bfr: "𝔟",
		bigcap: "⋂",
		bigcirc: "◯",
		bigcup: "⋃",
		bigodot: "⨀",
		bigoplus: "⨁",
		bigotimes: "⨂",
		bigsqcup: "⨆",
		bigstar: "★",
		bigtriangledown: "▽",
		bigtriangleup: "△",
		biguplus: "⨄",
		bigvee: "⋁",
		bigwedge: "⋀",
		bkarow: "⤍",
		blacklozenge: "⧫",
		blacksquare: "▪",
		blacktriangle: "▴",
		blacktriangledown: "▾",
		blacktriangleleft: "◂",
		blacktriangleright: "▸",
		blank: "␣",
		blk12: "▒",
		blk14: "░",
		blk34: "▓",
		block: "█",
		bne: "=⃥",
		bnequiv: "≡⃥",
		bNot: "⫭",
		bnot: "⌐",
		Bopf: "𝔹",
		bopf: "𝕓",
		bot: "⊥",
		bottom: "⊥",
		bowtie: "⋈",
		boxbox: "⧉",
		boxDL: "╗",
		boxDl: "╖",
		boxdL: "╕",
		boxdl: "┐",
		boxDR: "╔",
		boxDr: "╓",
		boxdR: "╒",
		boxdr: "┌",
		boxH: "═",
		boxh: "─",
		boxHD: "╦",
		boxHd: "╤",
		boxhD: "╥",
		boxhd: "┬",
		boxHU: "╩",
		boxHu: "╧",
		boxhU: "╨",
		boxhu: "┴",
		boxminus: "⊟",
		boxplus: "⊞",
		boxtimes: "⊠",
		boxUL: "╝",
		boxUl: "╜",
		boxuL: "╛",
		boxul: "┘",
		boxUR: "╚",
		boxUr: "╙",
		boxuR: "╘",
		boxur: "└",
		boxV: "║",
		boxv: "│",
		boxVH: "╬",
		boxVh: "╫",
		boxvH: "╪",
		boxvh: "┼",
		boxVL: "╣",
		boxVl: "╢",
		boxvL: "╡",
		boxvl: "┤",
		boxVR: "╠",
		boxVr: "╟",
		boxvR: "╞",
		boxvr: "├",
		bprime: "‵",
		Breve: "˘",
		breve: "˘",
		brvbar: "¦",
		Bscr: "ℬ",
		bscr: "𝒷",
		bsemi: "⁏",
		bsim: "∽",
		bsime: "⋍",
		bsol: "\\",
		bsolb: "⧅",
		bsolhsub: "⟈",
		bull: "•",
		bullet: "•",
		bump: "≎",
		bumpE: "⪮",
		bumpe: "≏",
		Bumpeq: "≎",
		bumpeq: "≏",
		Cacute: "Ć",
		cacute: "ć",
		Cap: "⋒",
		cap: "∩",
		capand: "⩄",
		capbrcup: "⩉",
		capcap: "⩋",
		capcup: "⩇",
		capdot: "⩀",
		CapitalDifferentialD: "ⅅ",
		caps: "∩︀",
		caret: "⁁",
		caron: "ˇ",
		Cayleys: "ℭ",
		ccaps: "⩍",
		Ccaron: "Č",
		ccaron: "č",
		Ccedil: "Ç",
		ccedil: "ç",
		Ccirc: "Ĉ",
		ccirc: "ĉ",
		Cconint: "∰",
		ccups: "⩌",
		ccupssm: "⩐",
		Cdot: "Ċ",
		cdot: "ċ",
		cedil: "¸",
		Cedilla: "¸",
		cemptyv: "⦲",
		cent: "¢",
		CenterDot: "·",
		centerdot: "·",
		Cfr: "ℭ",
		cfr: "𝔠",
		CHcy: "Ч",
		chcy: "ч",
		check: "✓",
		checkmark: "✓",
		Chi: "Χ",
		chi: "χ",
		cir: "○",
		circ: "ˆ",
		circeq: "≗",
		circlearrowleft: "↺",
		circlearrowright: "↻",
		circledast: "⊛",
		circledcirc: "⊚",
		circleddash: "⊝",
		CircleDot: "⊙",
		circledR: "®",
		circledS: "Ⓢ",
		CircleMinus: "⊖",
		CirclePlus: "⊕",
		CircleTimes: "⊗",
		cirE: "⧃",
		cire: "≗",
		cirfnint: "⨐",
		cirmid: "⫯",
		cirscir: "⧂",
		ClockwiseContourIntegral: "∲",
		CloseCurlyDoubleQuote: "”",
		CloseCurlyQuote: "’",
		clubs: "♣",
		clubsuit: "♣",
		Colon: "∷",
		colon: ":",
		Colone: "⩴",
		colone: "≔",
		coloneq: "≔",
		comma: ",",
		commat: "@",
		comp: "∁",
		compfn: "∘",
		complement: "∁",
		complexes: "ℂ",
		cong: "≅",
		congdot: "⩭",
		Congruent: "≡",
		Conint: "∯",
		conint: "∮",
		ContourIntegral: "∮",
		Copf: "ℂ",
		copf: "𝕔",
		coprod: "∐",
		Coproduct: "∐",
		COPY: "©",
		copy: "©",
		copysr: "℗",
		CounterClockwiseContourIntegral: "∳",
		crarr: "↵",
		Cross: "⨯",
		cross: "✗",
		Cscr: "𝒞",
		cscr: "𝒸",
		csub: "⫏",
		csube: "⫑",
		csup: "⫐",
		csupe: "⫒",
		ctdot: "⋯",
		cudarrl: "⤸",
		cudarrr: "⤵",
		cuepr: "⋞",
		cuesc: "⋟",
		cularr: "↶",
		cularrp: "⤽",
		Cup: "⋓",
		cup: "∪",
		cupbrcap: "⩈",
		CupCap: "≍",
		cupcap: "⩆",
		cupcup: "⩊",
		cupdot: "⊍",
		cupor: "⩅",
		cups: "∪︀",
		curarr: "↷",
		curarrm: "⤼",
		curlyeqprec: "⋞",
		curlyeqsucc: "⋟",
		curlyvee: "⋎",
		curlywedge: "⋏",
		curren: "¤",
		curvearrowleft: "↶",
		curvearrowright: "↷",
		cuvee: "⋎",
		cuwed: "⋏",
		cwconint: "∲",
		cwint: "∱",
		cylcty: "⌭",
		Dagger: "‡",
		dagger: "†",
		daleth: "ℸ",
		Darr: "↡",
		dArr: "⇓",
		darr: "↓",
		dash: "‐",
		Dashv: "⫤",
		dashv: "⊣",
		dbkarow: "⤏",
		dblac: "˝",
		Dcaron: "Ď",
		dcaron: "ď",
		Dcy: "Д",
		dcy: "д",
		DD: "ⅅ",
		dd: "ⅆ",
		ddagger: "‡",
		ddarr: "⇊",
		DDotrahd: "⤑",
		ddotseq: "⩷",
		deg: "°",
		Del: "∇",
		Delta: "Δ",
		delta: "δ",
		demptyv: "⦱",
		dfisht: "⥿",
		Dfr: "𝔇",
		dfr: "𝔡",
		dHar: "⥥",
		dharl: "⇃",
		dharr: "⇂",
		DiacriticalAcute: "´",
		DiacriticalDot: "˙",
		DiacriticalDoubleAcute: "˝",
		DiacriticalGrave: "`",
		DiacriticalTilde: "˜",
		diam: "⋄",
		Diamond: "⋄",
		diamond: "⋄",
		diamondsuit: "♦",
		diams: "♦",
		die: "¨",
		DifferentialD: "ⅆ",
		digamma: "ϝ",
		disin: "⋲",
		div: "÷",
		divide: "÷",
		divideontimes: "⋇",
		divonx: "⋇",
		DJcy: "Ђ",
		djcy: "ђ",
		dlcorn: "⌞",
		dlcrop: "⌍",
		dollar: "$",
		Dopf: "𝔻",
		dopf: "𝕕",
		Dot: "¨",
		dot: "˙",
		DotDot: "⃜",
		doteq: "≐",
		doteqdot: "≑",
		DotEqual: "≐",
		dotminus: "∸",
		dotplus: "∔",
		dotsquare: "⊡",
		doublebarwedge: "⌆",
		DoubleContourIntegral: "∯",
		DoubleDot: "¨",
		DoubleDownArrow: "⇓",
		DoubleLeftArrow: "⇐",
		DoubleLeftRightArrow: "⇔",
		DoubleLeftTee: "⫤",
		DoubleLongLeftArrow: "⟸",
		DoubleLongLeftRightArrow: "⟺",
		DoubleLongRightArrow: "⟹",
		DoubleRightArrow: "⇒",
		DoubleRightTee: "⊨",
		DoubleUpArrow: "⇑",
		DoubleUpDownArrow: "⇕",
		DoubleVerticalBar: "∥",
		DownArrow: "↓",
		Downarrow: "⇓",
		downarrow: "↓",
		DownArrowBar: "⤓",
		DownArrowUpArrow: "⇵",
		DownBreve: "̑",
		downdownarrows: "⇊",
		downharpoonleft: "⇃",
		downharpoonright: "⇂",
		DownLeftRightVector: "⥐",
		DownLeftTeeVector: "⥞",
		DownLeftVector: "↽",
		DownLeftVectorBar: "⥖",
		DownRightTeeVector: "⥟",
		DownRightVector: "⇁",
		DownRightVectorBar: "⥗",
		DownTee: "⊤",
		DownTeeArrow: "↧",
		drbkarow: "⤐",
		drcorn: "⌟",
		drcrop: "⌌",
		Dscr: "𝒟",
		dscr: "𝒹",
		DScy: "Ѕ",
		dscy: "ѕ",
		dsol: "⧶",
		Dstrok: "Đ",
		dstrok: "đ",
		dtdot: "⋱",
		dtri: "▿",
		dtrif: "▾",
		duarr: "⇵",
		duhar: "⥯",
		dwangle: "⦦",
		DZcy: "Џ",
		dzcy: "џ",
		dzigrarr: "⟿",
		Eacute: "É",
		eacute: "é",
		easter: "⩮",
		Ecaron: "Ě",
		ecaron: "ě",
		ecir: "≖",
		Ecirc: "Ê",
		ecirc: "ê",
		ecolon: "≕",
		Ecy: "Э",
		ecy: "э",
		eDDot: "⩷",
		Edot: "Ė",
		eDot: "≑",
		edot: "ė",
		ee: "ⅇ",
		efDot: "≒",
		Efr: "𝔈",
		efr: "𝔢",
		eg: "⪚",
		Egrave: "È",
		egrave: "è",
		egs: "⪖",
		egsdot: "⪘",
		el: "⪙",
		Element: "∈",
		elinters: "⏧",
		ell: "ℓ",
		els: "⪕",
		elsdot: "⪗",
		Emacr: "Ē",
		emacr: "ē",
		empty: "∅",
		emptyset: "∅",
		EmptySmallSquare: "◻",
		emptyv: "∅",
		EmptyVerySmallSquare: "▫",
		emsp: " ",
		emsp13: " ",
		emsp14: " ",
		ENG: "Ŋ",
		eng: "ŋ",
		ensp: " ",
		Eogon: "Ę",
		eogon: "ę",
		Eopf: "𝔼",
		eopf: "𝕖",
		epar: "⋕",
		eparsl: "⧣",
		eplus: "⩱",
		epsi: "ε",
		Epsilon: "Ε",
		epsilon: "ε",
		epsiv: "ϵ",
		eqcirc: "≖",
		eqcolon: "≕",
		eqsim: "≂",
		eqslantgtr: "⪖",
		eqslantless: "⪕",
		Equal: "⩵",
		equals: "=",
		EqualTilde: "≂",
		equest: "≟",
		Equilibrium: "⇌",
		equiv: "≡",
		equivDD: "⩸",
		eqvparsl: "⧥",
		erarr: "⥱",
		erDot: "≓",
		Escr: "ℰ",
		escr: "ℯ",
		esdot: "≐",
		Esim: "⩳",
		esim: "≂",
		Eta: "Η",
		eta: "η",
		ETH: "Ð",
		eth: "ð",
		Euml: "Ë",
		euml: "ë",
		euro: "€",
		excl: "!",
		exist: "∃",
		Exists: "∃",
		expectation: "ℰ",
		ExponentialE: "ⅇ",
		exponentiale: "ⅇ",
		fallingdotseq: "≒",
		Fcy: "Ф",
		fcy: "ф",
		female: "♀",
		ffilig: "ﬃ",
		fflig: "ﬀ",
		ffllig: "ﬄ",
		Ffr: "𝔉",
		ffr: "𝔣",
		filig: "ﬁ",
		FilledSmallSquare: "◼",
		FilledVerySmallSquare: "▪",
		fjlig: "fj",
		flat: "♭",
		fllig: "ﬂ",
		fltns: "▱",
		fnof: "ƒ",
		Fopf: "𝔽",
		fopf: "𝕗",
		ForAll: "∀",
		forall: "∀",
		fork: "⋔",
		forkv: "⫙",
		Fouriertrf: "ℱ",
		fpartint: "⨍",
		frac12: "½",
		frac13: "⅓",
		frac14: "¼",
		frac15: "⅕",
		frac16: "⅙",
		frac18: "⅛",
		frac23: "⅔",
		frac25: "⅖",
		frac34: "¾",
		frac35: "⅗",
		frac38: "⅜",
		frac45: "⅘",
		frac56: "⅚",
		frac58: "⅝",
		frac78: "⅞",
		frasl: "⁄",
		frown: "⌢",
		Fscr: "ℱ",
		fscr: "𝒻",
		gacute: "ǵ",
		Gamma: "Γ",
		gamma: "γ",
		Gammad: "Ϝ",
		gammad: "ϝ",
		gap: "⪆",
		Gbreve: "Ğ",
		gbreve: "ğ",
		Gcedil: "Ģ",
		Gcirc: "Ĝ",
		gcirc: "ĝ",
		Gcy: "Г",
		gcy: "г",
		Gdot: "Ġ",
		gdot: "ġ",
		gE: "≧",
		ge: "≥",
		gEl: "⪌",
		gel: "⋛",
		geq: "≥",
		geqq: "≧",
		geqslant: "⩾",
		ges: "⩾",
		gescc: "⪩",
		gesdot: "⪀",
		gesdoto: "⪂",
		gesdotol: "⪄",
		gesl: "⋛︀",
		gesles: "⪔",
		Gfr: "𝔊",
		gfr: "𝔤",
		Gg: "⋙",
		gg: "≫",
		ggg: "⋙",
		gimel: "ℷ",
		GJcy: "Ѓ",
		gjcy: "ѓ",
		gl: "≷",
		gla: "⪥",
		glE: "⪒",
		glj: "⪤",
		gnap: "⪊",
		gnapprox: "⪊",
		gnE: "≩",
		gne: "⪈",
		gneq: "⪈",
		gneqq: "≩",
		gnsim: "⋧",
		Gopf: "𝔾",
		gopf: "𝕘",
		grave: "`",
		GreaterEqual: "≥",
		GreaterEqualLess: "⋛",
		GreaterFullEqual: "≧",
		GreaterGreater: "⪢",
		GreaterLess: "≷",
		GreaterSlantEqual: "⩾",
		GreaterTilde: "≳",
		Gscr: "𝒢",
		gscr: "ℊ",
		gsim: "≳",
		gsime: "⪎",
		gsiml: "⪐",
		Gt: "≫",
		GT: ">",
		gt: ">",
		gtcc: "⪧",
		gtcir: "⩺",
		gtdot: "⋗",
		gtlPar: "⦕",
		gtquest: "⩼",
		gtrapprox: "⪆",
		gtrarr: "⥸",
		gtrdot: "⋗",
		gtreqless: "⋛",
		gtreqqless: "⪌",
		gtrless: "≷",
		gtrsim: "≳",
		gvertneqq: "≩︀",
		gvnE: "≩︀",
		Hacek: "ˇ",
		hairsp: " ",
		half: "½",
		hamilt: "ℋ",
		HARDcy: "Ъ",
		hardcy: "ъ",
		hArr: "⇔",
		harr: "↔",
		harrcir: "⥈",
		harrw: "↭",
		Hat: "^",
		hbar: "ℏ",
		Hcirc: "Ĥ",
		hcirc: "ĥ",
		hearts: "♥",
		heartsuit: "♥",
		hellip: "…",
		hercon: "⊹",
		Hfr: "ℌ",
		hfr: "𝔥",
		HilbertSpace: "ℋ",
		hksearow: "⤥",
		hkswarow: "⤦",
		hoarr: "⇿",
		homtht: "∻",
		hookleftarrow: "↩",
		hookrightarrow: "↪",
		Hopf: "ℍ",
		hopf: "𝕙",
		horbar: "―",
		HorizontalLine: "─",
		Hscr: "ℋ",
		hscr: "𝒽",
		hslash: "ℏ",
		Hstrok: "Ħ",
		hstrok: "ħ",
		HumpDownHump: "≎",
		HumpEqual: "≏",
		hybull: "⁃",
		hyphen: "‐",
		Iacute: "Í",
		iacute: "í",
		ic: "⁣",
		Icirc: "Î",
		icirc: "î",
		Icy: "И",
		icy: "и",
		Idot: "İ",
		IEcy: "Е",
		iecy: "е",
		iexcl: "¡",
		iff: "⇔",
		Ifr: "ℑ",
		ifr: "𝔦",
		Igrave: "Ì",
		igrave: "ì",
		ii: "ⅈ",
		iiiint: "⨌",
		iiint: "∭",
		iinfin: "⧜",
		iiota: "℩",
		IJlig: "Ĳ",
		ijlig: "ĳ",
		Im: "ℑ",
		Imacr: "Ī",
		imacr: "ī",
		image: "ℑ",
		ImaginaryI: "ⅈ",
		imagline: "ℐ",
		imagpart: "ℑ",
		imath: "ı",
		imof: "⊷",
		imped: "Ƶ",
		Implies: "⇒",
		in: "∈",
		incare: "℅",
		infin: "∞",
		infintie: "⧝",
		inodot: "ı",
		Int: "∬",
		int: "∫",
		intcal: "⊺",
		integers: "ℤ",
		Integral: "∫",
		intercal: "⊺",
		Intersection: "⋂",
		intlarhk: "⨗",
		intprod: "⨼",
		InvisibleComma: "⁣",
		InvisibleTimes: "⁢",
		IOcy: "Ё",
		iocy: "ё",
		Iogon: "Į",
		iogon: "į",
		Iopf: "𝕀",
		iopf: "𝕚",
		Iota: "Ι",
		iota: "ι",
		iprod: "⨼",
		iquest: "¿",
		Iscr: "ℐ",
		iscr: "𝒾",
		isin: "∈",
		isindot: "⋵",
		isinE: "⋹",
		isins: "⋴",
		isinsv: "⋳",
		isinv: "∈",
		it: "⁢",
		Itilde: "Ĩ",
		itilde: "ĩ",
		Iukcy: "І",
		iukcy: "і",
		Iuml: "Ï",
		iuml: "ï",
		Jcirc: "Ĵ",
		jcirc: "ĵ",
		Jcy: "Й",
		jcy: "й",
		Jfr: "𝔍",
		jfr: "𝔧",
		jmath: "ȷ",
		Jopf: "𝕁",
		jopf: "𝕛",
		Jscr: "𝒥",
		jscr: "𝒿",
		Jsercy: "Ј",
		jsercy: "ј",
		Jukcy: "Є",
		jukcy: "є",
		Kappa: "Κ",
		kappa: "κ",
		kappav: "ϰ",
		Kcedil: "Ķ",
		kcedil: "ķ",
		Kcy: "К",
		kcy: "к",
		Kfr: "𝔎",
		kfr: "𝔨",
		kgreen: "ĸ",
		KHcy: "Х",
		khcy: "х",
		KJcy: "Ќ",
		kjcy: "ќ",
		Kopf: "𝕂",
		kopf: "𝕜",
		Kscr: "𝒦",
		kscr: "𝓀",
		lAarr: "⇚",
		Lacute: "Ĺ",
		lacute: "ĺ",
		laemptyv: "⦴",
		lagran: "ℒ",
		Lambda: "Λ",
		lambda: "λ",
		Lang: "⟪",
		lang: "⟨",
		langd: "⦑",
		langle: "⟨",
		lap: "⪅",
		Laplacetrf: "ℒ",
		laquo: "«",
		Larr: "↞",
		lArr: "⇐",
		larr: "←",
		larrb: "⇤",
		larrbfs: "⤟",
		larrfs: "⤝",
		larrhk: "↩",
		larrlp: "↫",
		larrpl: "⤹",
		larrsim: "⥳",
		larrtl: "↢",
		lat: "⪫",
		lAtail: "⤛",
		latail: "⤙",
		late: "⪭",
		lates: "⪭︀",
		lBarr: "⤎",
		lbarr: "⤌",
		lbbrk: "❲",
		lbrace: "{",
		lbrack: "[",
		lbrke: "⦋",
		lbrksld: "⦏",
		lbrkslu: "⦍",
		Lcaron: "Ľ",
		lcaron: "ľ",
		Lcedil: "Ļ",
		lcedil: "ļ",
		lceil: "⌈",
		lcub: "{",
		Lcy: "Л",
		lcy: "л",
		ldca: "⤶",
		ldquo: "“",
		ldquor: "„",
		ldrdhar: "⥧",
		ldrushar: "⥋",
		ldsh: "↲",
		lE: "≦",
		le: "≤",
		LeftAngleBracket: "⟨",
		LeftArrow: "←",
		Leftarrow: "⇐",
		leftarrow: "←",
		LeftArrowBar: "⇤",
		LeftArrowRightArrow: "⇆",
		leftarrowtail: "↢",
		LeftCeiling: "⌈",
		LeftDoubleBracket: "⟦",
		LeftDownTeeVector: "⥡",
		LeftDownVector: "⇃",
		LeftDownVectorBar: "⥙",
		LeftFloor: "⌊",
		leftharpoondown: "↽",
		leftharpoonup: "↼",
		leftleftarrows: "⇇",
		LeftRightArrow: "↔",
		Leftrightarrow: "⇔",
		leftrightarrow: "↔",
		leftrightarrows: "⇆",
		leftrightharpoons: "⇋",
		leftrightsquigarrow: "↭",
		LeftRightVector: "⥎",
		LeftTee: "⊣",
		LeftTeeArrow: "↤",
		LeftTeeVector: "⥚",
		leftthreetimes: "⋋",
		LeftTriangle: "⊲",
		LeftTriangleBar: "⧏",
		LeftTriangleEqual: "⊴",
		LeftUpDownVector: "⥑",
		LeftUpTeeVector: "⥠",
		LeftUpVector: "↿",
		LeftUpVectorBar: "⥘",
		LeftVector: "↼",
		LeftVectorBar: "⥒",
		lEg: "⪋",
		leg: "⋚",
		leq: "≤",
		leqq: "≦",
		leqslant: "⩽",
		les: "⩽",
		lescc: "⪨",
		lesdot: "⩿",
		lesdoto: "⪁",
		lesdotor: "⪃",
		lesg: "⋚︀",
		lesges: "⪓",
		lessapprox: "⪅",
		lessdot: "⋖",
		lesseqgtr: "⋚",
		lesseqqgtr: "⪋",
		LessEqualGreater: "⋚",
		LessFullEqual: "≦",
		LessGreater: "≶",
		lessgtr: "≶",
		LessLess: "⪡",
		lesssim: "≲",
		LessSlantEqual: "⩽",
		LessTilde: "≲",
		lfisht: "⥼",
		lfloor: "⌊",
		Lfr: "𝔏",
		lfr: "𝔩",
		lg: "≶",
		lgE: "⪑",
		lHar: "⥢",
		lhard: "↽",
		lharu: "↼",
		lharul: "⥪",
		lhblk: "▄",
		LJcy: "Љ",
		ljcy: "љ",
		Ll: "⋘",
		ll: "≪",
		llarr: "⇇",
		llcorner: "⌞",
		Lleftarrow: "⇚",
		llhard: "⥫",
		lltri: "◺",
		Lmidot: "Ŀ",
		lmidot: "ŀ",
		lmoust: "⎰",
		lmoustache: "⎰",
		lnap: "⪉",
		lnapprox: "⪉",
		lnE: "≨",
		lne: "⪇",
		lneq: "⪇",
		lneqq: "≨",
		lnsim: "⋦",
		loang: "⟬",
		loarr: "⇽",
		lobrk: "⟦",
		LongLeftArrow: "⟵",
		Longleftarrow: "⟸",
		longleftarrow: "⟵",
		LongLeftRightArrow: "⟷",
		Longleftrightarrow: "⟺",
		longleftrightarrow: "⟷",
		longmapsto: "⟼",
		LongRightArrow: "⟶",
		Longrightarrow: "⟹",
		longrightarrow: "⟶",
		looparrowleft: "↫",
		looparrowright: "↬",
		lopar: "⦅",
		Lopf: "𝕃",
		lopf: "𝕝",
		loplus: "⨭",
		lotimes: "⨴",
		lowast: "∗",
		lowbar: "_",
		LowerLeftArrow: "↙",
		LowerRightArrow: "↘",
		loz: "◊",
		lozenge: "◊",
		lozf: "⧫",
		lpar: "(",
		lparlt: "⦓",
		lrarr: "⇆",
		lrcorner: "⌟",
		lrhar: "⇋",
		lrhard: "⥭",
		lrm: "‎",
		lrtri: "⊿",
		lsaquo: "‹",
		Lscr: "ℒ",
		lscr: "𝓁",
		Lsh: "↰",
		lsh: "↰",
		lsim: "≲",
		lsime: "⪍",
		lsimg: "⪏",
		lsqb: "[",
		lsquo: "‘",
		lsquor: "‚",
		Lstrok: "Ł",
		lstrok: "ł",
		Lt: "≪",
		LT: "<",
		lt: "<",
		ltcc: "⪦",
		ltcir: "⩹",
		ltdot: "⋖",
		lthree: "⋋",
		ltimes: "⋉",
		ltlarr: "⥶",
		ltquest: "⩻",
		ltri: "◃",
		ltrie: "⊴",
		ltrif: "◂",
		ltrPar: "⦖",
		lurdshar: "⥊",
		luruhar: "⥦",
		lvertneqq: "≨︀",
		lvnE: "≨︀",
		macr: "¯",
		male: "♂",
		malt: "✠",
		maltese: "✠",
		Map: "⤅",
		map: "↦",
		mapsto: "↦",
		mapstodown: "↧",
		mapstoleft: "↤",
		mapstoup: "↥",
		marker: "▮",
		mcomma: "⨩",
		Mcy: "М",
		mcy: "м",
		mdash: "—",
		mDDot: "∺",
		measuredangle: "∡",
		MediumSpace: " ",
		Mellintrf: "ℳ",
		Mfr: "𝔐",
		mfr: "𝔪",
		mho: "℧",
		micro: "µ",
		mid: "∣",
		midast: "*",
		midcir: "⫰",
		middot: "·",
		minus: "−",
		minusb: "⊟",
		minusd: "∸",
		minusdu: "⨪",
		MinusPlus: "∓",
		mlcp: "⫛",
		mldr: "…",
		mnplus: "∓",
		models: "⊧",
		Mopf: "𝕄",
		mopf: "𝕞",
		mp: "∓",
		Mscr: "ℳ",
		mscr: "𝓂",
		mstpos: "∾",
		Mu: "Μ",
		mu: "μ",
		multimap: "⊸",
		mumap: "⊸",
		nabla: "∇",
		Nacute: "Ń",
		nacute: "ń",
		nang: "∠⃒",
		nap: "≉",
		napE: "⩰̸",
		napid: "≋̸",
		napos: "ŉ",
		napprox: "≉",
		natur: "♮",
		natural: "♮",
		naturals: "ℕ",
		nbsp: "\xA0",
		nbump: "≎̸",
		nbumpe: "≏̸",
		ncap: "⩃",
		Ncaron: "Ň",
		ncaron: "ň",
		Ncedil: "Ņ",
		ncedil: "ņ",
		ncong: "≇",
		ncongdot: "⩭̸",
		ncup: "⩂",
		Ncy: "Н",
		ncy: "н",
		ndash: "–",
		ne: "≠",
		nearhk: "⤤",
		neArr: "⇗",
		nearr: "↗",
		nearrow: "↗",
		nedot: "≐̸",
		NegativeMediumSpace: "​",
		NegativeThickSpace: "​",
		NegativeThinSpace: "​",
		NegativeVeryThinSpace: "​",
		nequiv: "≢",
		nesear: "⤨",
		nesim: "≂̸",
		NestedGreaterGreater: "≫",
		NestedLessLess: "≪",
		NewLine: "\n",
		nexist: "∄",
		nexists: "∄",
		Nfr: "𝔑",
		nfr: "𝔫",
		ngE: "≧̸",
		nge: "≱",
		ngeq: "≱",
		ngeqq: "≧̸",
		ngeqslant: "⩾̸",
		nges: "⩾̸",
		nGg: "⋙̸",
		ngsim: "≵",
		nGt: "≫⃒",
		ngt: "≯",
		ngtr: "≯",
		nGtv: "≫̸",
		nhArr: "⇎",
		nharr: "↮",
		nhpar: "⫲",
		ni: "∋",
		nis: "⋼",
		nisd: "⋺",
		niv: "∋",
		NJcy: "Њ",
		njcy: "њ",
		nlArr: "⇍",
		nlarr: "↚",
		nldr: "‥",
		nlE: "≦̸",
		nle: "≰",
		nLeftarrow: "⇍",
		nleftarrow: "↚",
		nLeftrightarrow: "⇎",
		nleftrightarrow: "↮",
		nleq: "≰",
		nleqq: "≦̸",
		nleqslant: "⩽̸",
		nles: "⩽̸",
		nless: "≮",
		nLl: "⋘̸",
		nlsim: "≴",
		nLt: "≪⃒",
		nlt: "≮",
		nltri: "⋪",
		nltrie: "⋬",
		nLtv: "≪̸",
		nmid: "∤",
		NoBreak: "⁠",
		NonBreakingSpace: "\xA0",
		Nopf: "ℕ",
		nopf: "𝕟",
		Not: "⫬",
		not: "¬",
		NotCongruent: "≢",
		NotCupCap: "≭",
		NotDoubleVerticalBar: "∦",
		NotElement: "∉",
		NotEqual: "≠",
		NotEqualTilde: "≂̸",
		NotExists: "∄",
		NotGreater: "≯",
		NotGreaterEqual: "≱",
		NotGreaterFullEqual: "≧̸",
		NotGreaterGreater: "≫̸",
		NotGreaterLess: "≹",
		NotGreaterSlantEqual: "⩾̸",
		NotGreaterTilde: "≵",
		NotHumpDownHump: "≎̸",
		NotHumpEqual: "≏̸",
		notin: "∉",
		notindot: "⋵̸",
		notinE: "⋹̸",
		notinva: "∉",
		notinvb: "⋷",
		notinvc: "⋶",
		NotLeftTriangle: "⋪",
		NotLeftTriangleBar: "⧏̸",
		NotLeftTriangleEqual: "⋬",
		NotLess: "≮",
		NotLessEqual: "≰",
		NotLessGreater: "≸",
		NotLessLess: "≪̸",
		NotLessSlantEqual: "⩽̸",
		NotLessTilde: "≴",
		NotNestedGreaterGreater: "⪢̸",
		NotNestedLessLess: "⪡̸",
		notni: "∌",
		notniva: "∌",
		notnivb: "⋾",
		notnivc: "⋽",
		NotPrecedes: "⊀",
		NotPrecedesEqual: "⪯̸",
		NotPrecedesSlantEqual: "⋠",
		NotReverseElement: "∌",
		NotRightTriangle: "⋫",
		NotRightTriangleBar: "⧐̸",
		NotRightTriangleEqual: "⋭",
		NotSquareSubset: "⊏̸",
		NotSquareSubsetEqual: "⋢",
		NotSquareSuperset: "⊐̸",
		NotSquareSupersetEqual: "⋣",
		NotSubset: "⊂⃒",
		NotSubsetEqual: "⊈",
		NotSucceeds: "⊁",
		NotSucceedsEqual: "⪰̸",
		NotSucceedsSlantEqual: "⋡",
		NotSucceedsTilde: "≿̸",
		NotSuperset: "⊃⃒",
		NotSupersetEqual: "⊉",
		NotTilde: "≁",
		NotTildeEqual: "≄",
		NotTildeFullEqual: "≇",
		NotTildeTilde: "≉",
		NotVerticalBar: "∤",
		npar: "∦",
		nparallel: "∦",
		nparsl: "⫽⃥",
		npart: "∂̸",
		npolint: "⨔",
		npr: "⊀",
		nprcue: "⋠",
		npre: "⪯̸",
		nprec: "⊀",
		npreceq: "⪯̸",
		nrArr: "⇏",
		nrarr: "↛",
		nrarrc: "⤳̸",
		nrarrw: "↝̸",
		nRightarrow: "⇏",
		nrightarrow: "↛",
		nrtri: "⋫",
		nrtrie: "⋭",
		nsc: "⊁",
		nsccue: "⋡",
		nsce: "⪰̸",
		Nscr: "𝒩",
		nscr: "𝓃",
		nshortmid: "∤",
		nshortparallel: "∦",
		nsim: "≁",
		nsime: "≄",
		nsimeq: "≄",
		nsmid: "∤",
		nspar: "∦",
		nsqsube: "⋢",
		nsqsupe: "⋣",
		nsub: "⊄",
		nsubE: "⫅̸",
		nsube: "⊈",
		nsubset: "⊂⃒",
		nsubseteq: "⊈",
		nsubseteqq: "⫅̸",
		nsucc: "⊁",
		nsucceq: "⪰̸",
		nsup: "⊅",
		nsupE: "⫆̸",
		nsupe: "⊉",
		nsupset: "⊃⃒",
		nsupseteq: "⊉",
		nsupseteqq: "⫆̸",
		ntgl: "≹",
		Ntilde: "Ñ",
		ntilde: "ñ",
		ntlg: "≸",
		ntriangleleft: "⋪",
		ntrianglelefteq: "⋬",
		ntriangleright: "⋫",
		ntrianglerighteq: "⋭",
		Nu: "Ν",
		nu: "ν",
		num: "#",
		numero: "№",
		numsp: " ",
		nvap: "≍⃒",
		nVDash: "⊯",
		nVdash: "⊮",
		nvDash: "⊭",
		nvdash: "⊬",
		nvge: "≥⃒",
		nvgt: ">⃒",
		nvHarr: "⤄",
		nvinfin: "⧞",
		nvlArr: "⤂",
		nvle: "≤⃒",
		nvlt: "<⃒",
		nvltrie: "⊴⃒",
		nvrArr: "⤃",
		nvrtrie: "⊵⃒",
		nvsim: "∼⃒",
		nwarhk: "⤣",
		nwArr: "⇖",
		nwarr: "↖",
		nwarrow: "↖",
		nwnear: "⤧",
		Oacute: "Ó",
		oacute: "ó",
		oast: "⊛",
		ocir: "⊚",
		Ocirc: "Ô",
		ocirc: "ô",
		Ocy: "О",
		ocy: "о",
		odash: "⊝",
		Odblac: "Ő",
		odblac: "ő",
		odiv: "⨸",
		odot: "⊙",
		odsold: "⦼",
		OElig: "Œ",
		oelig: "œ",
		ofcir: "⦿",
		Ofr: "𝔒",
		ofr: "𝔬",
		ogon: "˛",
		Ograve: "Ò",
		ograve: "ò",
		ogt: "⧁",
		ohbar: "⦵",
		ohm: "Ω",
		oint: "∮",
		olarr: "↺",
		olcir: "⦾",
		olcross: "⦻",
		oline: "‾",
		olt: "⧀",
		Omacr: "Ō",
		omacr: "ō",
		Omega: "Ω",
		omega: "ω",
		Omicron: "Ο",
		omicron: "ο",
		omid: "⦶",
		ominus: "⊖",
		Oopf: "𝕆",
		oopf: "𝕠",
		opar: "⦷",
		OpenCurlyDoubleQuote: "“",
		OpenCurlyQuote: "‘",
		operp: "⦹",
		oplus: "⊕",
		Or: "⩔",
		or: "∨",
		orarr: "↻",
		ord: "⩝",
		order: "ℴ",
		orderof: "ℴ",
		ordf: "ª",
		ordm: "º",
		origof: "⊶",
		oror: "⩖",
		orslope: "⩗",
		orv: "⩛",
		oS: "Ⓢ",
		Oscr: "𝒪",
		oscr: "ℴ",
		Oslash: "Ø",
		oslash: "ø",
		osol: "⊘",
		Otilde: "Õ",
		otilde: "õ",
		Otimes: "⨷",
		otimes: "⊗",
		otimesas: "⨶",
		Ouml: "Ö",
		ouml: "ö",
		ovbar: "⌽",
		OverBar: "‾",
		OverBrace: "⏞",
		OverBracket: "⎴",
		OverParenthesis: "⏜",
		par: "∥",
		para: "¶",
		parallel: "∥",
		parsim: "⫳",
		parsl: "⫽",
		part: "∂",
		PartialD: "∂",
		Pcy: "П",
		pcy: "п",
		percnt: "%",
		period: ".",
		permil: "‰",
		perp: "⊥",
		pertenk: "‱",
		Pfr: "𝔓",
		pfr: "𝔭",
		Phi: "Φ",
		phi: "φ",
		phiv: "ϕ",
		phmmat: "ℳ",
		phone: "☎",
		Pi: "Π",
		pi: "π",
		pitchfork: "⋔",
		piv: "ϖ",
		planck: "ℏ",
		planckh: "ℎ",
		plankv: "ℏ",
		plus: "+",
		plusacir: "⨣",
		plusb: "⊞",
		pluscir: "⨢",
		plusdo: "∔",
		plusdu: "⨥",
		pluse: "⩲",
		PlusMinus: "±",
		plusmn: "±",
		plussim: "⨦",
		plustwo: "⨧",
		pm: "±",
		Poincareplane: "ℌ",
		pointint: "⨕",
		Popf: "ℙ",
		popf: "𝕡",
		pound: "£",
		Pr: "⪻",
		pr: "≺",
		prap: "⪷",
		prcue: "≼",
		prE: "⪳",
		pre: "⪯",
		prec: "≺",
		precapprox: "⪷",
		preccurlyeq: "≼",
		Precedes: "≺",
		PrecedesEqual: "⪯",
		PrecedesSlantEqual: "≼",
		PrecedesTilde: "≾",
		preceq: "⪯",
		precnapprox: "⪹",
		precneqq: "⪵",
		precnsim: "⋨",
		precsim: "≾",
		Prime: "″",
		prime: "′",
		primes: "ℙ",
		prnap: "⪹",
		prnE: "⪵",
		prnsim: "⋨",
		prod: "∏",
		Product: "∏",
		profalar: "⌮",
		profline: "⌒",
		profsurf: "⌓",
		prop: "∝",
		Proportion: "∷",
		Proportional: "∝",
		propto: "∝",
		prsim: "≾",
		prurel: "⊰",
		Pscr: "𝒫",
		pscr: "𝓅",
		Psi: "Ψ",
		psi: "ψ",
		puncsp: " ",
		Qfr: "𝔔",
		qfr: "𝔮",
		qint: "⨌",
		Qopf: "ℚ",
		qopf: "𝕢",
		qprime: "⁗",
		Qscr: "𝒬",
		qscr: "𝓆",
		quaternions: "ℍ",
		quatint: "⨖",
		quest: "?",
		questeq: "≟",
		QUOT: "\"",
		quot: "\"",
		rAarr: "⇛",
		race: "∽̱",
		Racute: "Ŕ",
		racute: "ŕ",
		radic: "√",
		raemptyv: "⦳",
		Rang: "⟫",
		rang: "⟩",
		rangd: "⦒",
		range: "⦥",
		rangle: "⟩",
		raquo: "»",
		Rarr: "↠",
		rArr: "⇒",
		rarr: "→",
		rarrap: "⥵",
		rarrb: "⇥",
		rarrbfs: "⤠",
		rarrc: "⤳",
		rarrfs: "⤞",
		rarrhk: "↪",
		rarrlp: "↬",
		rarrpl: "⥅",
		rarrsim: "⥴",
		Rarrtl: "⤖",
		rarrtl: "↣",
		rarrw: "↝",
		rAtail: "⤜",
		ratail: "⤚",
		ratio: "∶",
		rationals: "ℚ",
		RBarr: "⤐",
		rBarr: "⤏",
		rbarr: "⤍",
		rbbrk: "❳",
		rbrace: "}",
		rbrack: "]",
		rbrke: "⦌",
		rbrksld: "⦎",
		rbrkslu: "⦐",
		Rcaron: "Ř",
		rcaron: "ř",
		Rcedil: "Ŗ",
		rcedil: "ŗ",
		rceil: "⌉",
		rcub: "}",
		Rcy: "Р",
		rcy: "р",
		rdca: "⤷",
		rdldhar: "⥩",
		rdquo: "”",
		rdquor: "”",
		rdsh: "↳",
		Re: "ℜ",
		real: "ℜ",
		realine: "ℛ",
		realpart: "ℜ",
		reals: "ℝ",
		rect: "▭",
		REG: "®",
		reg: "®",
		ReverseElement: "∋",
		ReverseEquilibrium: "⇋",
		ReverseUpEquilibrium: "⥯",
		rfisht: "⥽",
		rfloor: "⌋",
		Rfr: "ℜ",
		rfr: "𝔯",
		rHar: "⥤",
		rhard: "⇁",
		rharu: "⇀",
		rharul: "⥬",
		Rho: "Ρ",
		rho: "ρ",
		rhov: "ϱ",
		RightAngleBracket: "⟩",
		RightArrow: "→",
		Rightarrow: "⇒",
		rightarrow: "→",
		RightArrowBar: "⇥",
		RightArrowLeftArrow: "⇄",
		rightarrowtail: "↣",
		RightCeiling: "⌉",
		RightDoubleBracket: "⟧",
		RightDownTeeVector: "⥝",
		RightDownVector: "⇂",
		RightDownVectorBar: "⥕",
		RightFloor: "⌋",
		rightharpoondown: "⇁",
		rightharpoonup: "⇀",
		rightleftarrows: "⇄",
		rightleftharpoons: "⇌",
		rightrightarrows: "⇉",
		rightsquigarrow: "↝",
		RightTee: "⊢",
		RightTeeArrow: "↦",
		RightTeeVector: "⥛",
		rightthreetimes: "⋌",
		RightTriangle: "⊳",
		RightTriangleBar: "⧐",
		RightTriangleEqual: "⊵",
		RightUpDownVector: "⥏",
		RightUpTeeVector: "⥜",
		RightUpVector: "↾",
		RightUpVectorBar: "⥔",
		RightVector: "⇀",
		RightVectorBar: "⥓",
		ring: "˚",
		risingdotseq: "≓",
		rlarr: "⇄",
		rlhar: "⇌",
		rlm: "‏",
		rmoust: "⎱",
		rmoustache: "⎱",
		rnmid: "⫮",
		roang: "⟭",
		roarr: "⇾",
		robrk: "⟧",
		ropar: "⦆",
		Ropf: "ℝ",
		ropf: "𝕣",
		roplus: "⨮",
		rotimes: "⨵",
		RoundImplies: "⥰",
		rpar: ")",
		rpargt: "⦔",
		rppolint: "⨒",
		rrarr: "⇉",
		Rrightarrow: "⇛",
		rsaquo: "›",
		Rscr: "ℛ",
		rscr: "𝓇",
		Rsh: "↱",
		rsh: "↱",
		rsqb: "]",
		rsquo: "’",
		rsquor: "’",
		rthree: "⋌",
		rtimes: "⋊",
		rtri: "▹",
		rtrie: "⊵",
		rtrif: "▸",
		rtriltri: "⧎",
		RuleDelayed: "⧴",
		ruluhar: "⥨",
		rx: "℞",
		Sacute: "Ś",
		sacute: "ś",
		sbquo: "‚",
		Sc: "⪼",
		sc: "≻",
		scap: "⪸",
		Scaron: "Š",
		scaron: "š",
		sccue: "≽",
		scE: "⪴",
		sce: "⪰",
		Scedil: "Ş",
		scedil: "ş",
		Scirc: "Ŝ",
		scirc: "ŝ",
		scnap: "⪺",
		scnE: "⪶",
		scnsim: "⋩",
		scpolint: "⨓",
		scsim: "≿",
		Scy: "С",
		scy: "с",
		sdot: "⋅",
		sdotb: "⊡",
		sdote: "⩦",
		searhk: "⤥",
		seArr: "⇘",
		searr: "↘",
		searrow: "↘",
		sect: "§",
		semi: ";",
		seswar: "⤩",
		setminus: "∖",
		setmn: "∖",
		sext: "✶",
		Sfr: "𝔖",
		sfr: "𝔰",
		sfrown: "⌢",
		sharp: "♯",
		SHCHcy: "Щ",
		shchcy: "щ",
		SHcy: "Ш",
		shcy: "ш",
		ShortDownArrow: "↓",
		ShortLeftArrow: "←",
		shortmid: "∣",
		shortparallel: "∥",
		ShortRightArrow: "→",
		ShortUpArrow: "↑",
		shy: "­",
		Sigma: "Σ",
		sigma: "σ",
		sigmaf: "ς",
		sigmav: "ς",
		sim: "∼",
		simdot: "⩪",
		sime: "≃",
		simeq: "≃",
		simg: "⪞",
		simgE: "⪠",
		siml: "⪝",
		simlE: "⪟",
		simne: "≆",
		simplus: "⨤",
		simrarr: "⥲",
		slarr: "←",
		SmallCircle: "∘",
		smallsetminus: "∖",
		smashp: "⨳",
		smeparsl: "⧤",
		smid: "∣",
		smile: "⌣",
		smt: "⪪",
		smte: "⪬",
		smtes: "⪬︀",
		SOFTcy: "Ь",
		softcy: "ь",
		sol: "/",
		solb: "⧄",
		solbar: "⌿",
		Sopf: "𝕊",
		sopf: "𝕤",
		spades: "♠",
		spadesuit: "♠",
		spar: "∥",
		sqcap: "⊓",
		sqcaps: "⊓︀",
		sqcup: "⊔",
		sqcups: "⊔︀",
		Sqrt: "√",
		sqsub: "⊏",
		sqsube: "⊑",
		sqsubset: "⊏",
		sqsubseteq: "⊑",
		sqsup: "⊐",
		sqsupe: "⊒",
		sqsupset: "⊐",
		sqsupseteq: "⊒",
		squ: "□",
		Square: "□",
		square: "□",
		SquareIntersection: "⊓",
		SquareSubset: "⊏",
		SquareSubsetEqual: "⊑",
		SquareSuperset: "⊐",
		SquareSupersetEqual: "⊒",
		SquareUnion: "⊔",
		squarf: "▪",
		squf: "▪",
		srarr: "→",
		Sscr: "𝒮",
		sscr: "𝓈",
		ssetmn: "∖",
		ssmile: "⌣",
		sstarf: "⋆",
		Star: "⋆",
		star: "☆",
		starf: "★",
		straightepsilon: "ϵ",
		straightphi: "ϕ",
		strns: "¯",
		Sub: "⋐",
		sub: "⊂",
		subdot: "⪽",
		subE: "⫅",
		sube: "⊆",
		subedot: "⫃",
		submult: "⫁",
		subnE: "⫋",
		subne: "⊊",
		subplus: "⪿",
		subrarr: "⥹",
		Subset: "⋐",
		subset: "⊂",
		subseteq: "⊆",
		subseteqq: "⫅",
		SubsetEqual: "⊆",
		subsetneq: "⊊",
		subsetneqq: "⫋",
		subsim: "⫇",
		subsub: "⫕",
		subsup: "⫓",
		succ: "≻",
		succapprox: "⪸",
		succcurlyeq: "≽",
		Succeeds: "≻",
		SucceedsEqual: "⪰",
		SucceedsSlantEqual: "≽",
		SucceedsTilde: "≿",
		succeq: "⪰",
		succnapprox: "⪺",
		succneqq: "⪶",
		succnsim: "⋩",
		succsim: "≿",
		SuchThat: "∋",
		Sum: "∑",
		sum: "∑",
		sung: "♪",
		Sup: "⋑",
		sup: "⊃",
		sup1: "¹",
		sup2: "²",
		sup3: "³",
		supdot: "⪾",
		supdsub: "⫘",
		supE: "⫆",
		supe: "⊇",
		supedot: "⫄",
		Superset: "⊃",
		SupersetEqual: "⊇",
		suphsol: "⟉",
		suphsub: "⫗",
		suplarr: "⥻",
		supmult: "⫂",
		supnE: "⫌",
		supne: "⊋",
		supplus: "⫀",
		Supset: "⋑",
		supset: "⊃",
		supseteq: "⊇",
		supseteqq: "⫆",
		supsetneq: "⊋",
		supsetneqq: "⫌",
		supsim: "⫈",
		supsub: "⫔",
		supsup: "⫖",
		swarhk: "⤦",
		swArr: "⇙",
		swarr: "↙",
		swarrow: "↙",
		swnwar: "⤪",
		szlig: "ß",
		Tab: "	",
		target: "⌖",
		Tau: "Τ",
		tau: "τ",
		tbrk: "⎴",
		Tcaron: "Ť",
		tcaron: "ť",
		Tcedil: "Ţ",
		tcedil: "ţ",
		Tcy: "Т",
		tcy: "т",
		tdot: "⃛",
		telrec: "⌕",
		Tfr: "𝔗",
		tfr: "𝔱",
		there4: "∴",
		Therefore: "∴",
		therefore: "∴",
		Theta: "Θ",
		theta: "θ",
		thetasym: "ϑ",
		thetav: "ϑ",
		thickapprox: "≈",
		thicksim: "∼",
		ThickSpace: "  ",
		thinsp: " ",
		ThinSpace: " ",
		thkap: "≈",
		thksim: "∼",
		THORN: "Þ",
		thorn: "þ",
		Tilde: "∼",
		tilde: "˜",
		TildeEqual: "≃",
		TildeFullEqual: "≅",
		TildeTilde: "≈",
		times: "×",
		timesb: "⊠",
		timesbar: "⨱",
		timesd: "⨰",
		tint: "∭",
		toea: "⤨",
		top: "⊤",
		topbot: "⌶",
		topcir: "⫱",
		Topf: "𝕋",
		topf: "𝕥",
		topfork: "⫚",
		tosa: "⤩",
		tprime: "‴",
		TRADE: "™",
		trade: "™",
		triangle: "▵",
		triangledown: "▿",
		triangleleft: "◃",
		trianglelefteq: "⊴",
		triangleq: "≜",
		triangleright: "▹",
		trianglerighteq: "⊵",
		tridot: "◬",
		trie: "≜",
		triminus: "⨺",
		TripleDot: "⃛",
		triplus: "⨹",
		trisb: "⧍",
		tritime: "⨻",
		trpezium: "⏢",
		Tscr: "𝒯",
		tscr: "𝓉",
		TScy: "Ц",
		tscy: "ц",
		TSHcy: "Ћ",
		tshcy: "ћ",
		Tstrok: "Ŧ",
		tstrok: "ŧ",
		twixt: "≬",
		twoheadleftarrow: "↞",
		twoheadrightarrow: "↠",
		Uacute: "Ú",
		uacute: "ú",
		Uarr: "↟",
		uArr: "⇑",
		uarr: "↑",
		Uarrocir: "⥉",
		Ubrcy: "Ў",
		ubrcy: "ў",
		Ubreve: "Ŭ",
		ubreve: "ŭ",
		Ucirc: "Û",
		ucirc: "û",
		Ucy: "У",
		ucy: "у",
		udarr: "⇅",
		Udblac: "Ű",
		udblac: "ű",
		udhar: "⥮",
		ufisht: "⥾",
		Ufr: "𝔘",
		ufr: "𝔲",
		Ugrave: "Ù",
		ugrave: "ù",
		uHar: "⥣",
		uharl: "↿",
		uharr: "↾",
		uhblk: "▀",
		ulcorn: "⌜",
		ulcorner: "⌜",
		ulcrop: "⌏",
		ultri: "◸",
		Umacr: "Ū",
		umacr: "ū",
		uml: "¨",
		UnderBar: "_",
		UnderBrace: "⏟",
		UnderBracket: "⎵",
		UnderParenthesis: "⏝",
		Union: "⋃",
		UnionPlus: "⊎",
		Uogon: "Ų",
		uogon: "ų",
		Uopf: "𝕌",
		uopf: "𝕦",
		UpArrow: "↑",
		Uparrow: "⇑",
		uparrow: "↑",
		UpArrowBar: "⤒",
		UpArrowDownArrow: "⇅",
		UpDownArrow: "↕",
		Updownarrow: "⇕",
		updownarrow: "↕",
		UpEquilibrium: "⥮",
		upharpoonleft: "↿",
		upharpoonright: "↾",
		uplus: "⊎",
		UpperLeftArrow: "↖",
		UpperRightArrow: "↗",
		Upsi: "ϒ",
		upsi: "υ",
		upsih: "ϒ",
		Upsilon: "Υ",
		upsilon: "υ",
		UpTee: "⊥",
		UpTeeArrow: "↥",
		upuparrows: "⇈",
		urcorn: "⌝",
		urcorner: "⌝",
		urcrop: "⌎",
		Uring: "Ů",
		uring: "ů",
		urtri: "◹",
		Uscr: "𝒰",
		uscr: "𝓊",
		utdot: "⋰",
		Utilde: "Ũ",
		utilde: "ũ",
		utri: "▵",
		utrif: "▴",
		uuarr: "⇈",
		Uuml: "Ü",
		uuml: "ü",
		uwangle: "⦧",
		vangrt: "⦜",
		varepsilon: "ϵ",
		varkappa: "ϰ",
		varnothing: "∅",
		varphi: "ϕ",
		varpi: "ϖ",
		varpropto: "∝",
		vArr: "⇕",
		varr: "↕",
		varrho: "ϱ",
		varsigma: "ς",
		varsubsetneq: "⊊︀",
		varsubsetneqq: "⫋︀",
		varsupsetneq: "⊋︀",
		varsupsetneqq: "⫌︀",
		vartheta: "ϑ",
		vartriangleleft: "⊲",
		vartriangleright: "⊳",
		Vbar: "⫫",
		vBar: "⫨",
		vBarv: "⫩",
		Vcy: "В",
		vcy: "в",
		VDash: "⊫",
		Vdash: "⊩",
		vDash: "⊨",
		vdash: "⊢",
		Vdashl: "⫦",
		Vee: "⋁",
		vee: "∨",
		veebar: "⊻",
		veeeq: "≚",
		vellip: "⋮",
		Verbar: "‖",
		verbar: "|",
		Vert: "‖",
		vert: "|",
		VerticalBar: "∣",
		VerticalLine: "|",
		VerticalSeparator: "❘",
		VerticalTilde: "≀",
		VeryThinSpace: " ",
		Vfr: "𝔙",
		vfr: "𝔳",
		vltri: "⊲",
		vnsub: "⊂⃒",
		vnsup: "⊃⃒",
		Vopf: "𝕍",
		vopf: "𝕧",
		vprop: "∝",
		vrtri: "⊳",
		Vscr: "𝒱",
		vscr: "𝓋",
		vsubnE: "⫋︀",
		vsubne: "⊊︀",
		vsupnE: "⫌︀",
		vsupne: "⊋︀",
		Vvdash: "⊪",
		vzigzag: "⦚",
		Wcirc: "Ŵ",
		wcirc: "ŵ",
		wedbar: "⩟",
		Wedge: "⋀",
		wedge: "∧",
		wedgeq: "≙",
		weierp: "℘",
		Wfr: "𝔚",
		wfr: "𝔴",
		Wopf: "𝕎",
		wopf: "𝕨",
		wp: "℘",
		wr: "≀",
		wreath: "≀",
		Wscr: "𝒲",
		wscr: "𝓌",
		xcap: "⋂",
		xcirc: "◯",
		xcup: "⋃",
		xdtri: "▽",
		Xfr: "𝔛",
		xfr: "𝔵",
		xhArr: "⟺",
		xharr: "⟷",
		Xi: "Ξ",
		xi: "ξ",
		xlArr: "⟸",
		xlarr: "⟵",
		xmap: "⟼",
		xnis: "⋻",
		xodot: "⨀",
		Xopf: "𝕏",
		xopf: "𝕩",
		xoplus: "⨁",
		xotime: "⨂",
		xrArr: "⟹",
		xrarr: "⟶",
		Xscr: "𝒳",
		xscr: "𝓍",
		xsqcup: "⨆",
		xuplus: "⨄",
		xutri: "△",
		xvee: "⋁",
		xwedge: "⋀",
		Yacute: "Ý",
		yacute: "ý",
		YAcy: "Я",
		yacy: "я",
		Ycirc: "Ŷ",
		ycirc: "ŷ",
		Ycy: "Ы",
		ycy: "ы",
		yen: "¥",
		Yfr: "𝔜",
		yfr: "𝔶",
		YIcy: "Ї",
		yicy: "ї",
		Yopf: "𝕐",
		yopf: "𝕪",
		Yscr: "𝒴",
		yscr: "𝓎",
		YUcy: "Ю",
		yucy: "ю",
		Yuml: "Ÿ",
		yuml: "ÿ",
		Zacute: "Ź",
		zacute: "ź",
		Zcaron: "Ž",
		zcaron: "ž",
		Zcy: "З",
		zcy: "з",
		Zdot: "Ż",
		zdot: "ż",
		zeetrf: "ℨ",
		ZeroWidthSpace: "​",
		Zeta: "Ζ",
		zeta: "ζ",
		Zfr: "ℨ",
		zfr: "𝔷",
		ZHcy: "Ж",
		zhcy: "ж",
		zigrarr: "⇝",
		Zopf: "ℤ",
		zopf: "𝕫",
		Zscr: "𝒵",
		zscr: "𝓏",
		zwj: "‍",
		zwnj: "‌"
	}), e.entityMap = e.HTML_ENTITIES;
})), Ht = /* @__PURE__ */ s(((e) => {
	var t = Lt(), n = zt(), r = Rt(), i = t.isHTMLEscapableRawTextElement, a = t.isHTMLMimeType, o = t.isHTMLRawTextElement, s = t.hasOwn, c = t.NAMESPACE, l = r.ParseError, u = r.DOMException, d = 0, f = 1, p = 2, m = 3, h = 4, g = 5, _ = 6, v = 7;
	function y() {}
	y.prototype = { parse: function(e, t, n) {
		var r = this.domBuilder;
		r.startDocument(), E(t, t = Object.create(null)), x(e, t, n, r, this.errorHandler), r.endDocument();
	} };
	var b = /&#?\w+;?/g;
	function x(e, r, i, o, c) {
		var d = a(o.mimeType);
		e.indexOf(n.UNICODE_REPLACEMENT_CHARACTER) >= 0 && c.warning("Unicode replacement character detected, source encoding issues?");
		function f(e) {
			if (e > 65535) {
				e -= 65536;
				var t = 55296 + (e >> 10), n = 56320 + (e & 1023);
				return String.fromCharCode(t, n);
			} else return String.fromCharCode(e);
		}
		function p(e) {
			var t = e[e.length - 1] === ";" ? e : e + ";";
			if (!d && t !== e) return c.error("EntityRef: expecting ;"), e;
			var r = n.Reference.exec(t);
			if (!r || r[0].length !== t.length) return c.error("entity not matching Reference production: " + e), e;
			var a = t.slice(1, -1);
			return s(i, a) ? i[a] : a.charAt(0) === "#" ? f(parseInt(a.substring(1).replace("x", "0x"))) : (c.error("entity not found:" + e), e);
		}
		function m(t) {
			if (t > D) {
				var n = e.substring(D, t).replace(b, p);
				v && y(D), o.characters(n, 0, t - D), D = t;
			}
		}
		var h = 0, g = 0, _ = /\r\n?|\n|$/g, v = o.locator;
		function y(t, n) {
			for (; t >= g && (n = _.exec(e));) h = g, g = n.index + n[0].length, v.lineNumber++;
			v.columnNumber = t - h + 1;
		}
		for (var x = [{ currentNSMap: r }], E = [], D = 0;;) {
			try {
				var O = e.indexOf("<", D);
				if (O < 0) {
					if (!d && E.length > 0) return c.fatalError("unclosed xml tag(s): " + E.join(", "));
					if (!e.substring(D).match(/^\s*$/)) {
						var M = o.doc, ee = M.createTextNode(e.substring(D));
						if (M.documentElement) return c.error("Extra content at the end of the document");
						M.appendChild(ee), o.currentElement = ee;
					}
					return;
				}
				if (O > D) {
					var te = e.substring(D, O);
					!d && E.length === 0 && (te = te.replace(new RegExp(n.S_OPT.source, "g"), ""), te && c.error("Unexpected content outside root element: '" + te + "'")), m(O);
				}
				switch (e.charAt(O + 1)) {
					case "/":
						var N = e.indexOf(">", O + 2), P = e.substring(O + 2, N > 0 ? N : void 0);
						if (!P) return c.fatalError("end tag name missing");
						var F = N > 0 && n.reg("^", n.QName_group, n.S_OPT, "$").exec(P);
						if (!F) return c.fatalError("end tag name contains invalid characters: \"" + P + "\"");
						if (!o.currentElement && !o.doc.documentElement) return;
						var I = E[E.length - 1] || o.currentElement.tagName || o.doc.documentElement.tagName || "";
						if (I !== F[1]) {
							var L = F[1].toLowerCase();
							if (!d || I.toLowerCase() !== L) return c.fatalError("Opening and ending tag mismatch: \"" + I + "\" != \"" + P + "\"");
						}
						var R = x.pop();
						E.pop();
						var z = R.localNSMap;
						if (o.endElement(R.uri, R.localName, I), z) for (var ne in z) s(z, ne) && o.endPrefixMapping(ne);
						N++;
						break;
					case "?":
						v && y(O), N = A(e, O, o, c);
						break;
					case "!":
						v && y(O), N = k(e, O, o, c, d);
						break;
					default:
						v && y(O);
						var B = new j(), re = x[x.length - 1].currentNSMap, N = C(e, O, B, re, p, c, d), ie = B.length;
						if (B.closed || (d && t.isHTMLVoidElement(B.tagName) ? B.closed = !0 : E.push(B.tagName)), v && ie) {
							for (var ae = S(v, {}), oe = 0; oe < ie; oe++) {
								var se = B[oe];
								y(se.offset), se.locator = S(v, {});
							}
							o.locator = ae, w(B, o, re) && x.push(B), o.locator = v;
						} else w(B, o, re) && x.push(B);
						d && !B.closed ? N = T(e, N, B.tagName, p, o) : N++;
				}
			} catch (e) {
				if (e instanceof l) throw e;
				if (e instanceof u) throw new l(e.name + ": " + e.message, o.locator, e);
				c.error("element parse error: " + e), N = -1;
			}
			N > D ? D = N : m(Math.max(O, D) + 1);
		}
	}
	function S(e, t) {
		return t.lineNumber = e.lineNumber, t.columnNumber = e.columnNumber, t;
	}
	function C(e, t, n, r, i, a, o) {
		function c(e, t, r) {
			if (s(n.attributeNames, e)) return a.fatalError("Attribute " + e + " redefined");
			if (!o && t.indexOf("<") >= 0) return a.fatalError("Unescaped '<' not allowed in attributes values");
			n.addValue(e, t.replace(/[\t\n\r]/g, " ").replace(b, i), r);
		}
		for (var l, u, y = ++t, x = d;;) {
			var S = e.charAt(y);
			switch (S) {
				case "=":
					if (x === f) l = e.slice(t, y), x = m;
					else if (x === p) x = m;
					else throw Error("attribute equal must after attrName");
					break;
				case "'":
				case "\"":
					if (x === m || x === f) if (x === f && (a.warning("attribute value must after \"=\""), l = e.slice(t, y)), t = y + 1, y = e.indexOf(S, t), y > 0) u = e.slice(t, y), c(l, u, t - 1), x = g;
					else throw Error("attribute value no end '" + S + "' match");
					else if (x == h) u = e.slice(t, y), c(l, u, t), a.warning("attribute \"" + l + "\" missed start quot(" + S + ")!!"), t = y + 1, x = g;
					else throw Error("attribute value must after \"=\"");
					break;
				case "/":
					switch (x) {
						case d: n.setTagName(e.slice(t, y));
						case g:
						case _:
						case v: x = v, n.closed = !0;
						case h:
						case f: break;
						case p:
							n.closed = !0;
							break;
						default: throw Error("attribute invalid close char('/')");
					}
					break;
				case "": return a.error("unexpected end of input"), x == d && n.setTagName(e.slice(t, y)), y;
				case ">":
					switch (x) {
						case d: n.setTagName(e.slice(t, y));
						case g:
						case _:
						case v: break;
						case h:
						case f: u = e.slice(t, y), u.slice(-1) === "/" && (n.closed = !0, u = u.slice(0, -1));
						case p:
							x === p && (u = l), x == h ? (a.warning("attribute \"" + u + "\" missed quot(\")!"), c(l, u, t)) : (o || a.warning("attribute \"" + u + "\" missed value!! \"" + u + "\" instead!!"), c(u, u, t));
							break;
						case m: if (!o) return a.fatalError("AttValue: ' or \" expected");
					}
					return y;
				case "": S = " ";
				default: if (S <= " ") switch (x) {
					case d:
						n.setTagName(e.slice(t, y)), x = _;
						break;
					case f:
						l = e.slice(t, y), x = p;
						break;
					case h:
						var u = e.slice(t, y);
						a.warning("attribute \"" + u + "\" missed quot(\")!!"), c(l, u, t);
					case g:
						x = _;
						break;
				}
				else switch (x) {
					case p:
						o || a.warning("attribute \"" + l + "\" missed value!! \"" + l + "\" instead2!!"), c(l, l, t), t = y, x = f;
						break;
					case g: a.warning("attribute space is required\"" + l + "\"!!");
					case _:
						x = f, t = y;
						break;
					case m:
						x = h, t = y;
						break;
					case v: throw Error("elements closed character '/' and '>' must be connected to");
				}
			}
			y++;
		}
	}
	function w(e, t, n) {
		for (var r = e.tagName, i = null, a = e.length; a--;) {
			var o = e[a], l = o.qName, u = o.value, d = l.indexOf(":");
			if (d > 0) var f = o.prefix = l.slice(0, d), p = l.slice(d + 1), m = f === "xmlns" && p;
			else p = l, f = null, m = l === "xmlns" && "";
			o.localName = p, m !== !1 && (i == null && (i = Object.create(null), E(n, n = Object.create(null))), n[m] = i[m] = u, o.uri = c.XMLNS, t.startPrefixMapping(m, u));
		}
		for (var a = e.length; a--;) o = e[a], o.prefix && (o.prefix === "xml" && (o.uri = c.XML), o.prefix !== "xmlns" && (o.uri = n[o.prefix]));
		var d = r.indexOf(":");
		d > 0 ? (f = e.prefix = r.slice(0, d), p = e.localName = r.slice(d + 1)) : (f = null, p = e.localName = r);
		var h = e.uri = n[f || ""];
		if (t.startElement(h, p, r, e), e.closed) {
			if (t.endElement(h, p, r), i) for (f in i) s(i, f) && t.endPrefixMapping(f);
		} else return e.currentNSMap = n, e.localNSMap = i, !0;
	}
	function T(e, t, n, r, a) {
		var s = i(n);
		if (s || o(n)) {
			var c = e.indexOf("</" + n + ">", t), l = e.substring(t + 1, c);
			return s && (l = l.replace(b, r)), a.characters(l, 0, l.length), c;
		}
		return t + 1;
	}
	function E(e, t) {
		for (var n in e) s(e, n) && (t[n] = e[n]);
	}
	function D(e, t) {
		var r = t;
		function i(t) {
			return t = t || 0, e.charAt(r + t);
		}
		function a(e) {
			e = e || 1, r += e;
		}
		function o() {
			for (var t = 0; r < e.length;) {
				var n = i();
				if (n !== " " && n !== "\n" && n !== "	" && n !== "\r") return t;
				t++, a();
			}
			return -1;
		}
		function s() {
			return e.substring(r);
		}
		function c(t) {
			return e.substring(r, r + t.length) === t;
		}
		function l(t) {
			return e.substring(r, r + t.length).toUpperCase() === t.toUpperCase();
		}
		function u(e) {
			var t = n.reg("^", e).exec(s());
			return t ? (a(t[0].length), t[0]) : null;
		}
		return {
			char: i,
			getIndex: function() {
				return r;
			},
			getMatch: u,
			getSource: function() {
				return e;
			},
			skip: a,
			skipBlanks: o,
			substringFromIndex: s,
			substringStartsWith: c,
			substringStartsWithCaseInsensitive: l
		};
	}
	function O(e, t) {
		function r(e, t) {
			var r = n.PI.exec(e.substringFromIndex());
			return r ? r[1].toLowerCase() === "xml" ? t.fatalError("xml declaration is only allowed at the start of the document, but found at position " + e.getIndex()) : (e.skip(r[0].length), r[0]) : t.fatalError("processing instruction is not well-formed at position " + e.getIndex());
		}
		var i = e.getSource();
		if (e.char() === "[") {
			e.skip(1);
			for (var a = e.getIndex(); e.getIndex() < i.length;) {
				if (e.skipBlanks(), e.char() === "]") {
					var o = i.substring(a, e.getIndex());
					return e.skip(1), o;
				}
				var s = null;
				if (e.char() === "<" && e.char(1) === "!") switch (e.char(2)) {
					case "E":
						e.char(3) === "L" ? s = e.getMatch(n.elementdecl) : e.char(3) === "N" && (s = e.getMatch(n.EntityDecl));
						break;
					case "A":
						s = e.getMatch(n.AttlistDecl);
						break;
					case "N":
						s = e.getMatch(n.NotationDecl);
						break;
					case "-":
						s = e.getMatch(n.Comment);
						break;
				}
				else if (e.char() === "<" && e.char(1) === "?") s = r(e, t);
				else if (e.char() === "%") s = e.getMatch(n.PEReference);
				else return t.fatalError("Error detected in Markup declaration");
				if (!s) return t.fatalError("Error in internal subset at position " + e.getIndex());
			}
			return t.fatalError("doctype internal subset is not well-formed, missing ]");
		}
	}
	function k(e, t, r, i, a) {
		var o = D(e, t);
		switch (a ? o.char(2).toUpperCase() : o.char(2)) {
			case "-":
				var s = o.getMatch(n.Comment);
				return s ? (r.comment(s, n.COMMENT_START.length, s.length - n.COMMENT_START.length - n.COMMENT_END.length), o.getIndex()) : i.fatalError("comment is not well-formed at position " + o.getIndex());
			case "[":
				var c = o.getMatch(n.CDSect);
				return c ? !a && !r.currentElement ? i.fatalError("CDATA outside of element") : (r.startCDATA(), r.characters(c, n.CDATA_START.length, c.length - n.CDATA_START.length - n.CDATA_END.length), r.endCDATA(), o.getIndex()) : i.fatalError("Invalid CDATA starting at position " + t);
			case "D":
				if (r.doc && r.doc.documentElement) return i.fatalError("Doctype not allowed inside or after documentElement at position " + o.getIndex());
				if (a ? !o.substringStartsWithCaseInsensitive(n.DOCTYPE_DECL_START) : !o.substringStartsWith(n.DOCTYPE_DECL_START)) return i.fatalError("Expected " + n.DOCTYPE_DECL_START + " at position " + o.getIndex());
				if (o.skip(n.DOCTYPE_DECL_START.length), o.skipBlanks() < 1) return i.fatalError("Expected whitespace after " + n.DOCTYPE_DECL_START + " at position " + o.getIndex());
				var l = {
					name: void 0,
					publicId: void 0,
					systemId: void 0,
					internalSubset: void 0
				};
				if (l.name = o.getMatch(n.Name), !l.name) return i.fatalError("doctype name missing or contains unexpected characters at position " + o.getIndex());
				if (a && l.name.toLowerCase() !== "html" && i.warning("Unexpected DOCTYPE in HTML document at position " + o.getIndex()), o.skipBlanks(), o.substringStartsWith(n.PUBLIC) || o.substringStartsWith(n.SYSTEM)) {
					var u = n.ExternalID_match.exec(o.substringFromIndex());
					if (!u) return i.fatalError("doctype external id is not well-formed at position " + o.getIndex());
					u.groups.SystemLiteralOnly === void 0 ? (l.systemId = u.groups.SystemLiteral, l.publicId = u.groups.PubidLiteral) : l.systemId = u.groups.SystemLiteralOnly, o.skip(u[0].length);
				} else if (a && o.substringStartsWithCaseInsensitive(n.SYSTEM)) {
					if (o.skip(n.SYSTEM.length), o.skipBlanks() < 1) return i.fatalError("Expected whitespace after " + n.SYSTEM + " at position " + o.getIndex());
					if (l.systemId = o.getMatch(n.ABOUT_LEGACY_COMPAT_SystemLiteral), !l.systemId) return i.fatalError("Expected " + n.ABOUT_LEGACY_COMPAT + " in single or double quotes after " + n.SYSTEM + " at position " + o.getIndex());
				}
				return a && l.systemId && !n.ABOUT_LEGACY_COMPAT_SystemLiteral.test(l.systemId) && i.warning("Unexpected doctype.systemId in HTML document at position " + o.getIndex()), a || (o.skipBlanks(), l.internalSubset = O(o, i)), o.skipBlanks(), o.char() === ">" ? (o.skip(1), r.startDTD(l.name, l.publicId, l.systemId, l.internalSubset), r.endDTD(), o.getIndex()) : i.fatalError("doctype not terminated with > at position " + o.getIndex());
			default: return i.fatalError("Not well-formed XML starting with \"<!\" at position " + t);
		}
	}
	function A(e, t, r, i) {
		var a = e.substring(t).match(n.PI);
		if (!a) return i.fatalError("Invalid processing instruction starting at position " + t);
		if (a[1].toLowerCase() === "xml") {
			if (t > 0) return i.fatalError("processing instruction at position " + t + " is an xml declaration which is only at the start of the document");
			if (!n.XMLDecl.test(e.substring(t))) return i.fatalError("xml declaration is not well-formed");
		}
		return r.processingInstruction(a[1], a[2]), t + a[0].length;
	}
	function j() {
		this.attributeNames = Object.create(null);
	}
	j.prototype = {
		setTagName: function(e) {
			if (!n.QName_exact.test(e)) throw Error("invalid tagName:" + e);
			this.tagName = e;
		},
		addValue: function(e, t, r) {
			if (!n.QName_exact.test(e)) throw Error("invalid attribute:" + e);
			this.attributeNames[e] = this.length, this[this.length++] = {
				qName: e,
				value: t,
				offset: r
			};
		},
		length: 0,
		getLocalName: function(e) {
			return this[e].localName;
		},
		getLocator: function(e) {
			return this[e].locator;
		},
		getQName: function(e) {
			return this[e].qName;
		},
		getURI: function(e) {
			return this[e].uri;
		},
		getValue: function(e) {
			return this[e].value;
		}
	}, e.XMLReader = y, e.parseUtils = D, e.parseDoctypeCommentOrCData = k;
})), Ut = /* @__PURE__ */ s(((e) => {
	var t = Lt(), n = Bt(), r = Rt(), i = Vt(), a = Ht(), o = n.DOMImplementation, s = t.hasDefaultHTMLNamespace, c = t.isHTMLMimeType, l = t.isValidMimeType, u = t.MIME_TYPE, d = t.NAMESPACE, f = r.ParseError, p = a.XMLReader;
	function m(e) {
		return e.replace(/\r[\n\u0085]/g, "\n").replace(/[\r\u0085\u2028\u2029]/g, "\n");
	}
	function h(e) {
		if (e = e || {}, e.locator === void 0 && (e.locator = !0), this.assign = e.assign || t.assign, this.domHandler = e.domHandler || g, this.onError = e.onError || e.errorHandler, e.errorHandler && typeof e.errorHandler != "function") throw TypeError("errorHandler object is no longer supported, switch to onError!");
		e.errorHandler && e.errorHandler("warning", "The `errorHandler` option has been deprecated, use `onError` instead!", this), this.normalizeLineEndings = e.normalizeLineEndings || m, this.locator = !!e.locator, this.xmlns = this.assign(Object.create(null), e.xmlns);
	}
	h.prototype.parseFromString = function(e, n) {
		if (!l(n)) throw TypeError("DOMParser.parseFromString: the provided mimeType \"" + n + "\" is not valid.");
		var r = this.assign(Object.create(null), this.xmlns), a = i.XML_ENTITIES, o = r[""] || null;
		s(n) ? (a = i.HTML_ENTITIES, o = d.HTML) : n === u.XML_SVG_IMAGE && (o = d.SVG), r[""] = o, r.xml = r.xml || d.XML;
		var c = new this.domHandler({
			mimeType: n,
			defaultNamespace: o,
			onError: this.onError
		}), f = this.locator ? {} : void 0;
		this.locator && c.setDocumentLocator(f);
		var m = new p();
		return m.errorHandler = c, m.domBuilder = c, !t.isHTMLMimeType(n) && typeof e != "string" && m.errorHandler.fatalError("source is not a string"), m.parse(this.normalizeLineEndings(String(e)), r, a), c.doc.documentElement || m.errorHandler.fatalError("missing root element"), c.doc;
	};
	function g(e) {
		var t = e || {};
		this.mimeType = t.mimeType || u.XML_APPLICATION, this.defaultNamespace = t.defaultNamespace || null, this.cdata = !1, this.currentElement = void 0, this.doc = void 0, this.locator = void 0, this.onError = t.onError;
	}
	function _(e, t) {
		t.lineNumber = e.lineNumber, t.columnNumber = e.columnNumber;
	}
	g.prototype = {
		startDocument: function() {
			var e = new o();
			this.doc = c(this.mimeType) ? e.createHTMLDocument(!1) : e.createDocument(this.defaultNamespace, "");
		},
		startElement: function(e, t, n, r) {
			var i = this.doc, a = i.createElementNS(e, n || t), o = r.length;
			b(this, a), this.currentElement = a, this.locator && _(this.locator, a);
			for (var s = 0; s < o; s++) {
				var e = r.getURI(s), c = r.getValue(s), n = r.getQName(s), l = i.createAttributeNS(e, n);
				this.locator && _(r.getLocator(s), l), l.value = l.nodeValue = c, a.setAttributeNode(l);
			}
		},
		endElement: function(e, t, n) {
			this.currentElement = this.currentElement.parentNode;
		},
		startPrefixMapping: function(e, t) {},
		endPrefixMapping: function(e) {},
		processingInstruction: function(e, t) {
			var n = this.doc.createProcessingInstruction(e, t);
			this.locator && _(this.locator, n), b(this, n);
		},
		ignorableWhitespace: function(e, t, n) {},
		characters: function(e, t, n) {
			if (e = y.apply(this, arguments), e) {
				if (this.cdata) var r = this.doc.createCDATASection(e);
				else var r = this.doc.createTextNode(e);
				this.currentElement ? this.currentElement.appendChild(r) : /^\s*$/.test(e) && this.doc.appendChild(r), this.locator && _(this.locator, r);
			}
		},
		skippedEntity: function(e) {},
		endDocument: function() {
			this.doc.normalize();
		},
		setDocumentLocator: function(e) {
			e && (e.lineNumber = 0), this.locator = e;
		},
		comment: function(e, t, n) {
			e = y.apply(this, arguments);
			var r = this.doc.createComment(e);
			this.locator && _(this.locator, r), b(this, r);
		},
		startCDATA: function() {
			this.cdata = !0;
		},
		endCDATA: function() {
			this.cdata = !1;
		},
		startDTD: function(e, t, n, r) {
			var i = this.doc.implementation;
			if (i && i.createDocumentType) {
				var a = i.createDocumentType(e, t, n, r);
				this.locator && _(this.locator, a), b(this, a), this.doc.doctype = a;
			}
		},
		reportError: function(e, t) {
			if (typeof this.onError == "function") try {
				this.onError(e, t, this);
			} catch (n) {
				throw new f("Reporting " + e + " \"" + t + "\" caused " + n, this.locator);
			}
			else console.error("[xmldom " + e + "]	" + t, v(this.locator));
		},
		warning: function(e) {
			this.reportError("warning", e);
		},
		error: function(e) {
			this.reportError("error", e);
		},
		fatalError: function(e) {
			throw this.reportError("fatalError", e), new f(e, this.locator);
		}
	};
	function v(e) {
		if (e) return "\n@#[line:" + e.lineNumber + ",col:" + e.columnNumber + "]";
	}
	function y(e, t, n) {
		return typeof e == "string" ? e.substr(t, n) : e.length >= t + n || t ? new java.lang.String(e, t, n) + "" : e;
	}
	"endDTD,startEntity,endEntity,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,resolveEntity,getExternalSubset,notationDecl,unparsedEntityDecl".replace(/\w+/g, function(e) {
		g.prototype[e] = function() {
			return null;
		};
	});
	function b(e, t) {
		e.currentElement ? e.currentElement.appendChild(t) : e.doc.appendChild(t);
	}
	function x(e) {
		if (e === "error") throw "onErrorStopParsing";
	}
	function S() {
		throw "onWarningStopParsing";
	}
	e.__DOMHandler = g, e.DOMParser = h, e.normalizeLineEndings = m, e.onErrorStopParsing = x, e.onWarningStopParsing = S;
})), Wt = (/* @__PURE__ */ s(((e) => {
	var t = Lt();
	e.assign = t.assign, e.hasDefaultHTMLNamespace = t.hasDefaultHTMLNamespace, e.isHTMLMimeType = t.isHTMLMimeType, e.isValidMimeType = t.isValidMimeType, e.MIME_TYPE = t.MIME_TYPE, e.NAMESPACE = t.NAMESPACE;
	var n = Rt();
	e.DOMException = n.DOMException, e.DOMExceptionName = n.DOMExceptionName, e.ExceptionCode = n.ExceptionCode, e.ParseError = n.ParseError;
	var r = Bt();
	e.Attr = r.Attr, e.CDATASection = r.CDATASection, e.CharacterData = r.CharacterData, e.Comment = r.Comment, e.Document = r.Document, e.DocumentFragment = r.DocumentFragment, e.DocumentType = r.DocumentType, e.DOMImplementation = r.DOMImplementation, e.Element = r.Element, e.Entity = r.Entity, e.EntityReference = r.EntityReference, e.LiveNodeList = r.LiveNodeList, e.NamedNodeMap = r.NamedNodeMap, e.Node = r.Node, e.NodeList = r.NodeList, e.Notation = r.Notation, e.ProcessingInstruction = r.ProcessingInstruction, e.Text = r.Text, e.XMLSerializer = r.XMLSerializer;
	var i = Ut();
	e.DOMParser = i.DOMParser, e.normalizeLineEndings = i.normalizeLineEndings, e.onErrorStopParsing = i.onErrorStopParsing, e.onWarningStopParsing = i.onWarningStopParsing;
})))(), Gt = Symbol("changed"), Kt = Symbol("classList"), qt = Symbol("CustomElements"), Jt = Symbol("content"), Yt = Symbol("dataset"), Xt = Symbol("doctype"), Zt = Symbol("DOMParser"), W = Symbol("end"), Qt = Symbol("EventTarget"), $t = Symbol("globals"), en = Symbol("image"), tn = Symbol("mime"), nn = Symbol("MutationObserver"), G = Symbol("next"), rn = Symbol("ownerElement"), an = Symbol("prev"), on = Symbol("private"), sn = Symbol("sheet"), cn = Symbol("start"), ln = Symbol("style"), un = Symbol("upgrade"), dn = Symbol("value"), fn, pn = new Map([
	[0, 65533],
	[128, 8364],
	[130, 8218],
	[131, 402],
	[132, 8222],
	[133, 8230],
	[134, 8224],
	[135, 8225],
	[136, 710],
	[137, 8240],
	[138, 352],
	[139, 8249],
	[140, 338],
	[142, 381],
	[145, 8216],
	[146, 8217],
	[147, 8220],
	[148, 8221],
	[149, 8226],
	[150, 8211],
	[151, 8212],
	[152, 732],
	[153, 8482],
	[154, 353],
	[155, 8250],
	[156, 339],
	[158, 382],
	[159, 376]
]), mn = (fn = String.fromCodePoint) == null ? ((e) => {
	let t = "";
	return e > 65535 && (e -= 65536, t += String.fromCharCode(e >>> 10 & 1023 | 55296), e = 56320 | e & 1023), t += String.fromCharCode(e), t;
}) : fn;
function hn(e) {
	var t;
	return e >= 55296 && e <= 57343 || e > 1114111 ? 65533 : (t = pn.get(e)) == null ? e : t;
}
//#endregion
//#region node_modules/.pnpm/entities@7.0.1/node_modules/entities/dist/esm/internal/decode-shared.js
function gn(e) {
	let t = typeof atob == "function" ? atob(e) : typeof Buffer.from == "function" ? Buffer.from(e, "base64").toString("binary") : new Buffer(e, "base64").toString("binary"), n = t.length & -2, r = new Uint16Array(n / 2);
	for (let e = 0, i = 0; e < n; e += 2) {
		let n = t.charCodeAt(e), a = t.charCodeAt(e + 1);
		r[i++] = n | a << 8;
	}
	return r;
}
//#endregion
//#region node_modules/.pnpm/entities@7.0.1/node_modules/entities/dist/esm/generated/decode-data-html.js
var _n = /* #__PURE__ */ gn("QR08ALkAAgH6AYsDNQR2BO0EPgXZBQEGLAbdBxMISQrvCmQLfQurDKQNLw4fD4YPpA+6D/IPAAAAAAAAAAAAAAAAKhBMEY8TmxUWF2EYLBkxGuAa3RsJHDscWR8YIC8jSCSIJcMl6ie3Ku8rEC0CLjoupS7kLgAIRU1hYmNmZ2xtbm9wcnN0dVQAWgBeAGUAaQBzAHcAfgCBAIQAhwCSAJoAoACsALMAbABpAGcAO4DGAMZAUAA7gCYAJkBjAHUAdABlADuAwQDBQHIiZXZlAAJhAAFpeW0AcgByAGMAO4DCAMJAEGRyAADgNdgE3XIAYQB2AGUAO4DAAMBA8CFoYZFj4SFjcgBhZAAAoFMqAAFncIsAjgBvAG4ABGFmAADgNdg43fAlbHlGdW5jdGlvbgCgYSBpAG4AZwA7gMUAxUAAAWNzpACoAHIAAOA12Jzc6SFnbgCgVCJpAGwAZABlADuAwwDDQG0AbAA7gMQAxEAABGFjZWZvcnN1xQDYANoA7QDxAPYA+QD8AAABY3LJAM8AayNzbGFzaAAAoBYidgHTANUAAKDnKmUAZAAAoAYjeQARZIABY3J0AOAA5QDrAGEidXNlAACgNSLuI291bGxpcwCgLCFhAJJjcgAA4DXYBd1wAGYAAOA12Dnd5SF2ZdhiYwDyAOoAbSJwZXEAAKBOIgAHSE9hY2RlZmhpbG9yc3UXARoBHwE6AVIBVQFiAWQBZgGCAakB6QHtAfIBYwB5ACdkUABZADuAqQCpQIABY3B5ACUBKAE1AfUhdGUGYWmg0iJ0KGFsRGlmZmVyZW50aWFsRAAAoEUhbCJleXMAAKAtIQACYWVpb0EBRAFKAU0B8iFvbgxhZABpAGwAO4DHAMdAcgBjAAhhbiJpbnQAAKAwIm8AdAAKYQABZG5ZAV0BaSJsbGEAuGB0I2VyRG90ALdg8gA5AWkAp2NyImNsZQAAAkRNUFRwAXQBeQF9AW8AdAAAoJkiaSJudXMAAKCWIuwhdXMAoJUiaSJtZXMAAKCXIm8AAAFjc4cBlAFrKndpc2VDb250b3VySW50ZWdyYWwAAKAyImUjQ3VybHkAAAFEUZwBpAFvJXVibGVRdW90ZQAAoB0gdSJvdGUAAKAZIAACbG5wdbABtgHNAdgBbwBuAGWgNyIAoHQqgAFnaXQAvAHBAcUB8iJ1ZW50AKBhIm4AdAAAoC8i7yV1ckludGVncmFsAKAuIgABZnLRAdMBAKACIe8iZHVjdACgECJuLnRlckNsb2Nrd2lzZUNvbnRvdXJJbnRlZ3JhbAAAoDMi7yFzcwCgLypjAHIAAOA12J7ccABDoNMiYQBwAACgTSKABURKU1phY2VmaW9zAAsCEgIVAhgCGwIsAjQCOQI9AnMCfwNvoEUh9CJyYWhkAKARKWMAeQACZGMAeQAFZGMAeQAPZIABZ3JzACECJQIoAuchZXIAoCEgcgAAoKEhaAB2AACg5CoAAWF5MAIzAvIhb24OYRRkbAB0oAciYQCUY3IAAOA12AfdAAFhZkECawIAAWNtRQJnAvIjaXRpY2FsAAJBREdUUAJUAl8CYwJjInV0ZQC0YG8AdAFZAloC2WJiJGxlQWN1dGUA3WJyImF2ZQBgYGkibGRlANxi7yFuZACgxCJmJWVyZW50aWFsRAAAoEYhcAR9AgAAAAAAAIECjgIAABoDZgAA4DXYO91EoagAhQKJAm8AdAAAoNwgcSJ1YWwAAKBQIuIhbGUAA0NETFJVVpkCqAK1Au8C/wIRA28AbgB0AG8AdQByAEkAbgB0AGUAZwByAGEA7ADEAW8AdAKvAgAAAACwAqhgbiNBcnJvdwAAoNMhAAFlb7kC0AJmAHQAgAFBUlQAwQLGAs0CciJyb3cAAKDQIekkZ2h0QXJyb3cAoNQhZQDlACsCbgBnAAABTFLWAugC5SFmdAABQVLcAuECciJyb3cAAKD4J+kkZ2h0QXJyb3cAoPon6SRnaHRBcnJvdwCg+SdpImdodAAAAUFU9gL7AnIicm93AACg0iFlAGUAAKCoInAAQQIGAwAAAAALA3Iicm93AACg0SFvJHduQXJyb3cAAKDVIWUlcnRpY2FsQmFyAACgJSJuAAADQUJMUlRhJAM2AzoDWgNxA3oDciJyb3cAAKGTIUJVLAMwA2EAcgAAoBMpcCNBcnJvdwAAoPUhciJldmUAEWPlIWZ00gJDAwAASwMAAFIDaSVnaHRWZWN0b3IAAKBQKWUkZVZlY3RvcgAAoF4p5SJjdG9yQqC9IWEAcgAAoFYpaSJnaHQA1AFiAwAAaQNlJGVWZWN0b3IAAKBfKeUiY3RvckKgwSFhAHIAAKBXKWUAZQBBoKQiciJyb3cAAKCnIXIAcgBvAPcAtAIAAWN0gwOHA3IA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YwAAoN8i4SFycnCgtiEAoD0pgKIqImJjZG9zACsVMBU6FT4VQRVyImNhcAAAoEgqAAFhdTQVNxVwAACgRipwAACgSipvAHQAAKCNInIAAKBFKgDgKiIA/gACYWxydksVURVuFXMVcgByAG2gtyEAoDwpeQCAAWV2dwBYFWUVaRVxAHACXxUAAAAAYxVyAGUA4wAXFXUA4wAZFWUAZQAAoM4iZSJkZ2UAAKDPImUAbgA7gKQApEBlI2Fycm93AAABbHJ7FX8V5SFmdACgtiFpImdodAAAoLchZQDkAG0VAAFjaYsVkRVvAG4AaQBuAPQAkwFuAHQAAKAxImwiY3R5AACgLSOACUFIYWJjZGVmaGlqbG9yc3R1d3oAuBW7Fb8V1RXgFegV+RUKFhUWHxZUFlcWZRbFFtsW7xb7FgUXChdyAPIAtAJhAHIAAKBlKQACZ2xyc8YVyhXOFdAV5yFlcgCgICDlIXRoAKA4IfIA9QxoAHagECAAoKMiawHZFd4VYSJyb3cAAKAPKWEA4wBfAgABYXnkFecV8iFvbg9hNGQAoUYhYW/tFfQVAAFnciEC8RVyAACgyiF0InNlcQAAoHcqgAFnbG0A/xUCFgUWO4CwALBAdABhALRjcCJ0eXYAAKCxKQABaXIOFhIW8yFodACgfykA4DXYId1hAHIAAAFschsWHRYAoMMhAKDCIYACYWVnc3YAKBauAjYWOhY+Fm0AAKHEIm9zLhY0Fm4AZABzoMQi9SFpdACgZiZhIm1tYQDdY2kAbgAAoPIiAKH3AGlvQxZRFmQAZQAAgfcAO29KFksW90BuI3RpbWVzAACgxyJuAPgAUBZjAHkAUmRjAG8CXhYAAAAAYhZyAG4AAKAeI28AcAAAoA0jgAJscHR1dwBuFnEWdRaSFp4W7CFhciRgZgAA4DXYVd0AotkCZW1wc30WhBaJFo0WcQBkoFAibwB0AACgUSJpIm51cwAAoDgi7CF1cwCgFCLxInVhcmUAoKEiYgBsAGUAYgBhAHIAdwBlAGQAZwDlANcAbgCAAWFkaAClFqoWtBZyAHIAbwD3APUMbwB3AG4AYQByAHIAbwB3APMA8xVhI3Jwb29uAAABbHK8FsAWZQBmAPQAHBZpAGcAaAD0AB4WYgHJFs8WawBhAHIAbwD3AJILbwLUFgAAAADYFnIAbgAAoB8jbwBwAACgDCOAAWNvdADhFukW7BYAAXJ55RboFgDgNdi53FVkbAAAoPYp8iFvaxFhAAFkcvMW9xZvAHQAAKDxImkA5qC/JVsSAAFhaP8WAhdyAPIANQNhAPIA1wvhIm5nbGUAoKYpAAFjaQ4XEBd5AF9k5yJyYXJyAKD/JwAJRGFjZGVmZ2xtbm9wcXJzdHV4MRc4F0YXWxcyBF4XaRd5F40XrBe0F78X2RcVGCEYLRg1GEAYAAFEbzUXgRZvAPQA+BUAAWNzPBdCF3UAdABlADuA6QDpQPQhZXIAoG4qAAJhaW95TRdQF1YXWhfyIW9uG2FyAGOgViI7gOoA6kDsIW9uAKBVIk1kbwB0ABdhAAFEcmIXZhdvAHQAAKBSIgDgNdgi3XKhmipuF3QXYQB2AGUAO4DoAOhAZKCWKm8AdAAAoJgqgKGZKmlscwCAF4UXhxfuInRlcnMAoOcjAKATIWSglSpvAHQAAKCXKoABYXBzAJMXlheiF2MAcgATYXQAeQBzogUinxcAAAAAoRdlAHQAAKAFInAAMaADIDMBqRerFwCgBCAAoAUgAAFnc7AXsRdLYXAAAKACIAABZ3C4F7sXbwBuABlhZgAA4DXYVt2AAWFscwDFF8sXzxdyAHOg1SJsAACg4yl1AHMAAKBxKmkAAKG1A2x21RfYF28AbgC1Y/VjAAJjc3V24BfoF/0XEBgAAWlv5BdWF3IAYwAAoFYiaQLuFwAAAADwF+0ADQThIW50AAFnbPUX+Rd0AHIAAKCWKuUhc3MAoJUqgAFhZWkAAxgGGAoYbABzAD1gcwB0AACgXyJ2AESgYSJEAACgeCrwImFyc2wAoOUpAAFEYRkYHRhvAHQAAKBTInIAcgAAoHEpgAFjZGkAJxgqGO0XcgAAoC8hbwD0AIwCAAFhaDEYMhi3YzuA8ADwQAABbXI5GD0YbAA7gOsA60BvAACgrCCAAWNpcABGGEgYSxhsACFgcwD0ACwEAAFlb08YVxhjAHQAYQB0AGkAbwDuABoEbgBlAG4AdABpAGEAbADlADME4Ql1GAAAgRgAAIMYiBgAAAAAoRilGAAAqhgAALsYvhjRGAAA1xgnGWwAbABpAG4AZwBkAG8AdABzAGUA8QBlF3kARGRtImFsZQAAoEAmgAFpbHIAjRiRGJ0Y7CFpZwCgA/tpApcYAAAAAJoYZwAAoAD7aQBnAACgBPsA4DXYI93sIWlnAKAB++whaWcA4GYAagCAAWFsdACvGLIYthh0AACgbSZpAGcAAKAC+24AcwAAoLElbwBmAJJh8AHCGAAAxhhmAADgNdhX3QABYWvJGMwYbADsAGsEdqDUIgCg2SphI3J0aW50AACgDSoAAWFv2hgiGQABY3PeGB8ZsQPnGP0YBRkSGRUZAAAdGbID7xjyGPQY9xj5GAAA+xg7gL0AvUAAoFMhO4C8ALxAAKBVIQCgWSEAoFshswEBGQAAAxkAoFQhAKBWIbQCCxkOGQAAAAAQGTuAvgC+QACgVyEAoFwhNQAAoFghtgEZGQAAGxkAoFohAKBdITgAAKBeIWwAAKBEIHcAbgAAoCIjYwByAADgNdi73IAIRWFiY2RlZmdpamxub3JzdHYARhlKGVoZXhlmGWkZkhmWGZkZnRmgGa0ZxhnLGc8Z4BkjGmygZyIAoIwqgAFjbXAAUBlTGVgZ9SF0ZfVhbQBhAOSgswM6FgCghipyImV2ZQAfYQABaXliGWUZcgBjAB1hM2RvAHQAIWGAoWUibHFzAMYEcBl6GfGhZSLOBAAAdhlsAGEAbgD0AN8EgKF+KmNkbACBGYQZjBljAACgqSpvAHQAb6CAKmyggioAoIQqZeDbIgD+cwAAoJQqcgAA4DXYJN3noGsirATtIWVsAKA3IWMAeQBTZIChdyJFYWoApxmpGasZAKCSKgCgpSoAoKQqAAJFYWVztBm2Gb0ZwhkAoGkicABwoIoq8iFveACgiipxoIgq8aCIKrUZaQBtAACg5yJwAGYAAOA12FjdYQB2AOUAYwIAAWNp0xnWGXIAAKAKIW0AAKFzImVs3BneGQCgjioAoJAqAIM+ADtjZGxxco0E6xn0GfgZ/BkBGgABY2nvGfEZAKCnKnIAAKB6Km8AdAAAoNci0CFhcgCglSl1ImVzdAAAoHwqgAJhZGVscwAKGvQZFhrVBCAa8AEPGgAAFBpwAHIAbwD4AFkZcgAAoHgpcQAAAWxxxAQbGmwAZQBzAPMASRlpAO0A5AQAAWVuJxouGnIjdG5lcXEAAOBpIgD+xQAsGgAFQWFiY2Vma29zeUAaQxpmGmoabRqDGocalhrCGtMacgDyAMwCAAJpbG1yShpOGlAaVBpyAHMA8ABxD2YAvWBpAGwA9AASBQABZHJYGlsaYwB5AEpkAKGUIWN3YBpkGmkAcgAAoEgpAKCtIWEAcgAAoA8h6SFyYyVhgAFhbHIAcxp7Gn8a8iF0c3WgZSZpAHQAAKBlJuwhaXAAoCYg4yFvbgCguSJyAADgNdgl3XMAAAFld4wakRphInJvdwAAoCUpYSJyb3cAAKAmKYACYW1vcHIAnxqjGqcauhq+GnIAcgAAoP8h9CFodACgOyJrAAABbHKsGrMaZSRmdGFycm93AACgqSHpJGdodGFycm93AKCqIWYAAOA12Fnd4iFhcgCgFSCAAWNsdADIGswa0BpyAADgNdi93GEAcwDoAGka8iFvaydhAAFicNca2xr1IWxsAKBDIOghZW4AoBAg4Qr2GgAA/RoAAAgbExsaGwAAIRs7GwAAAAA+G2IbmRuVG6sbAACyG80b0htjAHUAdABlADuA7QDtQAChYyBpeQEbBhtyAGMAO4DuAO5AOGQAAWN4CxsNG3kANWRjAGwAO4ChAKFAAAFmcssCFhsA4DXYJt1yAGEAdgBlADuA7ADsQIChSCFpbm8AJxsyGzYbAAFpbisbLxtuAHQAAKAMKnQAAKAtIuYhaW4AoNwpdABhAACgKSHsIWlnM2GAAWFvcABDG1sbXhuAAWNndABJG0sbWRtyACthgAFlbHAAcQVRG1UbaQBuAOUAyAVhAHIA9AByBWgAMWFmAACgtyJlAGQAtWEAoggiY2ZvdGkbbRt1G3kb4SFyZQCgBSFpAG4AdKAeImkAZQAAoN0pZABvAPQAWxsAoisiY2VscIEbhRuPG5QbYQBsAACguiIAAWdyiRuNG2UAcgDzACMQ4wCCG2EicmhrAACgFyryIW9kAKA8KgACY2dwdJ8boRukG6gbeQBRZG8AbgAvYWYAAOA12FrdYQC5Y3UAZQBzAHQAO4C/AL9AAAFjabUbuRtyAADgNdi+3G4AAKIIIkVkc3bCG8QbyBvQAwCg+SJvAHQAAKD1Inag9CIAoPMiaaBiIOwhZGUpYesB1hsAANkbYwB5AFZkbAA7gO8A70AAA2NmbW9zdeYb7hvyG/Ub+hsFHAABaXnqG+0bcgBjADVhOWRyAADgNdgn3eEhdGg3YnAAZgAA4DXYW93jAf8bAAADHHIAAOA12L/c8iFjeVhk6yFjeVRkAARhY2ZnaGpvcxUcGhwiHCYcKhwtHDAcNRzwIXBhdqC6A/BjAAFleR4cIRzkIWls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ZmdobG1vcHJzdHV3CiwNLBEsHSwnLDEsQCxLLFIsYix6LIQsjyzLLOgs7Sz/LAotcgDyAAkDYQByAACgYykAAWNyFSwbLHUAdABlADuA+gD6QPIACQ1yAOMBIywAACUseQBeZHYAZQBtYQABaXkrLDAscgBjADuA+wD7QENkgAFhYmgANyw6LD0scgDyANEO7CFhY3FhYQDyAOAOAAFpckQsSCzzIWh0AKB+KQDgNdgy3XIAYQB2AGUAO4D5APlAYQFWLF8scgAAAWxyWixcLACgvyEAoL4hbABrAACggCUAAWN0Zix2LG8CbCwAAAAAcyxyAG4AZaAcI3IAAKAcI28AcAAAoA8jcgBpAACg+CUAAWFsfiyBLGMAcgBrYTuAqACoQAABZ3CILIssbwBuAHNhZgAA4DXYZt0AA2FkaGxzdZksniynLLgsuyzFLHIAcgBvAPcACQ1vAHcAbgBhAHIAcgBvAPcA2A5hI3Jwb29uAAABbHKvLLMsZQBmAPQAWyxpAGcAaAD0AF0sdQDzAKYOaQAAocUDaGzBLMIs0mNvAG4AxWPwI2Fycm93cwCgyCGAAWNpdADRLOEs5CxvAtcsAAAAAN4scgBuAGWgHSNyAACgHSNvAHAAAKAOI24AZwBvYXIAaQAAoPklYwByAADgNdjK3IABZGlyAPMs9yz6LG8AdAAAoPAi7CFkZWlhaQBmoLUlAKC0JQABYW0DLQYtcgDyAMosbAA7gPwA/EDhIm5nbGUAoKcpgAdBQkRhY2RlZmxub3Byc3oAJy0qLTAtNC2bLZ0toS2/LcMtxy3TLdgt3C3gLfwtcgDyABADYQByAHag6CoAoOkqYQBzAOgA/gIAAW5yOC08LechcnQAoJwpgANla25wcnN0AJkpSC1NLVQtXi1iLYItYQBwAHAA4QAaHG8AdABoAGkAbgDnAKEXgAFoaXIAoSmzJFotbwBwAPQAdCVooJUh7wD4JgABaXVmLWotZwBtAOEAuygAAWJwbi14LXMjZXRuZXEAceCKIgD+AODLKgD+cyNldG5lcQBx4IsiAP4A4MwqAP4AAWhyhi2KLWUAdADhABIraSNhbmdsZQAAAWxyki2WLeUhZnQAoLIiaSJnaHQAAKCzInkAMmThIXNoAKCiIoABZWxyAKcttC24LWKiKCKuLQAAAACyLWEAcgAAoLsicQAAoFoi7CFpcACg7iIAAWJ0vC1eD2EA8gBfD3IAAOA12DPddAByAOkAlS1zAHUAAAFicM0t0C0A4IIi0iAA4IMi0iBwAGYAAOA12GfdcgBvAPAAWQt0AHIA6QCaLQABY3XkLegtcgAA4DXYy9wAAWJw7C30LW4AAAFFZXUt8S0A4IoiAP5uAAABRWV/LfktAOCLIgD+6SJnemFnAKCaKYADY2Vmb3BycwANLhAuJS4pLiMuLi40LukhcmN1YQABZGkULiEuAAFiZxguHC5hAHIAAKBfKmUAcaAnIgCgWSLlIXJwAKAYIXIAAOA12DTdcABmAADgNdho3WWgQCJhAHQA6ABqD2MAcgAA4DXYzNzjCuQRUC4AAFQuAABYLmIuAAAAAGMubS5wLnQuAAAAAIguki4AAJouJxIqEnQAcgDpAB0ScgAA4DXYNd0AAUFhWy5eLnIA8gDnAnIA8gCTB75jAAFBYWYuaS5yAPIA4AJyAPIAjAdhAPAAeh5pAHMAAKD7IoABZHB0APgReS6DLgABZmx9LoAuAOA12GnddQDzAP8RaQBtAOUABBIAAUFhiy6OLnIA8gDuAnIA8gCaBwABY3GVLgoScgAA4DXYzdwAAXB0nS6hLmwAdQDzACUScgDpACASAARhY2VmaW9zdbEuvC7ELsguzC7PLtQu2S5jAAABdXm2LrsudABlADuA/QD9QE9kAAFpecAuwy5yAGMAd2FLZG4AO4ClAKVAcgAA4DXYNt1jAHkAV2RwAGYAAOA12GrdYwByAADgNdjO3AABY23dLt8ueQBOZGwAO4D/AP9AAAVhY2RlZmhpb3N38y73Lv8uAi8MLxAvEy8YLx0vIi9jInV0ZQB6YQABYXn7Lv4u8iFvbn5hN2RvAHQAfGEAAWV0Bi8KL3QAcgDmAB8QYQC2Y3IAAOA12DfdYwB5ADZk5yJyYXJyAKDdIXAAZgAA4DXYa91jAHIAAOA12M/cAAFqbiYvKC8AoA0gagAAoAwg"), vn = /* #__PURE__ */ gn("AAJhZ2xxBwARABMAFQBtAg0AAAAAAA8AcAAmYG8AcwAnYHQAPmB0ADxg9SFvdCJg"), yn;
(function(e) {
	e[e.VALUE_LENGTH = 49152] = "VALUE_LENGTH", e[e.FLAG13 = 8192] = "FLAG13", e[e.BRANCH_LENGTH = 8064] = "BRANCH_LENGTH", e[e.JUMP_TABLE = 127] = "JUMP_TABLE";
})(yn || (yn = {}));
//#endregion
//#region node_modules/.pnpm/entities@7.0.1/node_modules/entities/dist/esm/decode.js
var bn;
(function(e) {
	e[e.NUM = 35] = "NUM", e[e.SEMI = 59] = "SEMI", e[e.EQUALS = 61] = "EQUALS", e[e.ZERO = 48] = "ZERO", e[e.NINE = 57] = "NINE", e[e.LOWER_A = 97] = "LOWER_A", e[e.LOWER_F = 102] = "LOWER_F", e[e.LOWER_X = 120] = "LOWER_X", e[e.LOWER_Z = 122] = "LOWER_Z", e[e.UPPER_A = 65] = "UPPER_A", e[e.UPPER_F = 70] = "UPPER_F", e[e.UPPER_Z = 90] = "UPPER_Z";
})(bn || (bn = {}));
var xn = 32;
function Sn(e) {
	return e >= bn.ZERO && e <= bn.NINE;
}
function Cn(e) {
	return e >= bn.UPPER_A && e <= bn.UPPER_F || e >= bn.LOWER_A && e <= bn.LOWER_F;
}
function wn(e) {
	return e >= bn.UPPER_A && e <= bn.UPPER_Z || e >= bn.LOWER_A && e <= bn.LOWER_Z || Sn(e);
}
function Tn(e) {
	return e === bn.EQUALS || wn(e);
}
var En;
(function(e) {
	e[e.EntityStart = 0] = "EntityStart", e[e.NumericStart = 1] = "NumericStart", e[e.NumericDecimal = 2] = "NumericDecimal", e[e.NumericHex = 3] = "NumericHex", e[e.NamedEntity = 4] = "NamedEntity";
})(En || (En = {}));
var Dn;
(function(e) {
	e[e.Legacy = 0] = "Legacy", e[e.Strict = 1] = "Strict", e[e.Attribute = 2] = "Attribute";
})(Dn || (Dn = {}));
var On = class {
	constructor(e, t, n) {
		this.decodeTree = e, this.emitCodePoint = t, this.errors = n, this.state = En.EntityStart, this.consumed = 1, this.result = 0, this.treeIndex = 0, this.excess = 1, this.decodeMode = Dn.Strict, this.runConsumed = 0;
	}
	startEntity(e) {
		this.decodeMode = e, this.state = En.EntityStart, this.result = 0, this.treeIndex = 0, this.excess = 1, this.consumed = 1, this.runConsumed = 0;
	}
	write(e, t) {
		switch (this.state) {
			case En.EntityStart: return e.charCodeAt(t) === bn.NUM ? (this.state = En.NumericStart, this.consumed += 1, this.stateNumericStart(e, t + 1)) : (this.state = En.NamedEntity, this.stateNamedEntity(e, t));
			case En.NumericStart: return this.stateNumericStart(e, t);
			case En.NumericDecimal: return this.stateNumericDecimal(e, t);
			case En.NumericHex: return this.stateNumericHex(e, t);
			case En.NamedEntity: return this.stateNamedEntity(e, t);
		}
	}
	stateNumericStart(e, t) {
		return t >= e.length ? -1 : (e.charCodeAt(t) | xn) === bn.LOWER_X ? (this.state = En.NumericHex, this.consumed += 1, this.stateNumericHex(e, t + 1)) : (this.state = En.NumericDecimal, this.stateNumericDecimal(e, t));
	}
	stateNumericHex(e, t) {
		for (; t < e.length;) {
			let n = e.charCodeAt(t);
			if (Sn(n) || Cn(n)) {
				let e = n <= bn.NINE ? n - bn.ZERO : (n | xn) - bn.LOWER_A + 10;
				this.result = this.result * 16 + e, this.consumed++, t++;
			} else return this.emitNumericEntity(n, 3);
		}
		return -1;
	}
	stateNumericDecimal(e, t) {
		for (; t < e.length;) {
			let n = e.charCodeAt(t);
			if (Sn(n)) this.result = this.result * 10 + (n - bn.ZERO), this.consumed++, t++;
			else return this.emitNumericEntity(n, 2);
		}
		return -1;
	}
	emitNumericEntity(e, t) {
		var n;
		if (this.consumed <= t) return (n = this.errors) == null || n.absenceOfDigitsInNumericCharacterReference(this.consumed), 0;
		if (e === bn.SEMI) this.consumed += 1;
		else if (this.decodeMode === Dn.Strict) return 0;
		return this.emitCodePoint(hn(this.result), this.consumed), this.errors && (e !== bn.SEMI && this.errors.missingSemicolonAfterCharacterReference(), this.errors.validateNumericCharacterReference(this.result)), this.consumed;
	}
	stateNamedEntity(e, t) {
		let { decodeTree: n } = this, r = n[this.treeIndex], i = (r & yn.VALUE_LENGTH) >> 14;
		for (; t < e.length;) {
			if (i === 0 && (r & yn.FLAG13) !== 0) {
				let a = (r & yn.BRANCH_LENGTH) >> 7;
				if (this.runConsumed === 0) {
					let n = r & yn.JUMP_TABLE;
					if (e.charCodeAt(t) !== n) return this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
					t++, this.excess++, this.runConsumed++;
				}
				for (; this.runConsumed < a;) {
					if (t >= e.length) return -1;
					let r = this.runConsumed - 1, i = n[this.treeIndex + 1 + (r >> 1)], a = r % 2 == 0 ? i & 255 : i >> 8 & 255;
					if (e.charCodeAt(t) !== a) return this.runConsumed = 0, this.result === 0 ? 0 : this.emitNotTerminatedNamedEntity();
					t++, this.excess++, this.runConsumed++;
				}
				this.runConsumed = 0, this.treeIndex += 1 + (a >> 1), r = n[this.treeIndex], i = (r & yn.VALUE_LENGTH) >> 14;
			}
			if (t >= e.length) break;
			let a = e.charCodeAt(t);
			if (a === bn.SEMI && i !== 0 && (r & yn.FLAG13) !== 0) return this.emitNamedEntityData(this.treeIndex, i, this.consumed + this.excess);
			if (this.treeIndex = kn(n, r, this.treeIndex + Math.max(1, i), a), this.treeIndex < 0) return this.result === 0 || this.decodeMode === Dn.Attribute && (i === 0 || Tn(a)) ? 0 : this.emitNotTerminatedNamedEntity();
			if (r = n[this.treeIndex], i = (r & yn.VALUE_LENGTH) >> 14, i !== 0) {
				if (a === bn.SEMI) return this.emitNamedEntityData(this.treeIndex, i, this.consumed + this.excess);
				this.decodeMode !== Dn.Strict && (r & yn.FLAG13) === 0 && (this.result = this.treeIndex, this.consumed += this.excess, this.excess = 0);
			}
			t++, this.excess++;
		}
		return -1;
	}
	emitNotTerminatedNamedEntity() {
		var e;
		let { result: t, decodeTree: n } = this, r = (n[t] & yn.VALUE_LENGTH) >> 14;
		return this.emitNamedEntityData(t, r, this.consumed), (e = this.errors) == null || e.missingSemicolonAfterCharacterReference(), this.consumed;
	}
	emitNamedEntityData(e, t, n) {
		let { decodeTree: r } = this;
		return this.emitCodePoint(t === 1 ? r[e] & ~(yn.VALUE_LENGTH | yn.FLAG13) : r[e + 1], n), t === 3 && this.emitCodePoint(r[e + 2], n), n;
	}
	end() {
		var e;
		switch (this.state) {
			case En.NamedEntity: return this.result !== 0 && (this.decodeMode !== Dn.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
			case En.NumericDecimal: return this.emitNumericEntity(0, 2);
			case En.NumericHex: return this.emitNumericEntity(0, 3);
			case En.NumericStart: return (e = this.errors) == null || e.absenceOfDigitsInNumericCharacterReference(this.consumed), 0;
			case En.EntityStart: return 0;
		}
	}
};
function kn(e, t, n, r) {
	let i = (t & yn.BRANCH_LENGTH) >> 7, a = t & yn.JUMP_TABLE;
	if (i === 0) return a !== 0 && r === a ? n : -1;
	if (a) {
		let t = r - a;
		return t < 0 || t >= i ? -1 : e[n + t] - 1;
	}
	let o = i + 1 >> 1, s = 0, c = i - 1;
	for (; s <= c;) {
		let t = s + c >>> 1, i = e[n + (t >> 1)] >> (t & 1) * 8 & 255;
		if (i < r) s = t + 1;
		else if (i > r) c = t - 1;
		else return e[n + o + t];
	}
	return -1;
}
//#endregion
//#region node_modules/.pnpm/htmlparser2@10.1.0/node_modules/htmlparser2/dist/esm/Tokenizer.js
var K;
(function(e) {
	e[e.Tab = 9] = "Tab", e[e.NewLine = 10] = "NewLine", e[e.FormFeed = 12] = "FormFeed", e[e.CarriageReturn = 13] = "CarriageReturn", e[e.Space = 32] = "Space", e[e.ExclamationMark = 33] = "ExclamationMark", e[e.Number = 35] = "Number", e[e.Amp = 38] = "Amp", e[e.SingleQuote = 39] = "SingleQuote", e[e.DoubleQuote = 34] = "DoubleQuote", e[e.Dash = 45] = "Dash", e[e.Slash = 47] = "Slash", e[e.Zero = 48] = "Zero", e[e.Nine = 57] = "Nine", e[e.Semi = 59] = "Semi", e[e.Lt = 60] = "Lt", e[e.Eq = 61] = "Eq", e[e.Gt = 62] = "Gt", e[e.Questionmark = 63] = "Questionmark", e[e.UpperA = 65] = "UpperA", e[e.LowerA = 97] = "LowerA", e[e.UpperF = 70] = "UpperF", e[e.LowerF = 102] = "LowerF", e[e.UpperZ = 90] = "UpperZ", e[e.LowerZ = 122] = "LowerZ", e[e.LowerX = 120] = "LowerX", e[e.OpeningSquareBracket = 91] = "OpeningSquareBracket";
})(K || (K = {}));
var q;
(function(e) {
	e[e.Text = 1] = "Text", e[e.BeforeTagName = 2] = "BeforeTagName", e[e.InTagName = 3] = "InTagName", e[e.InSelfClosingTag = 4] = "InSelfClosingTag", e[e.BeforeClosingTagName = 5] = "BeforeClosingTagName", e[e.InClosingTagName = 6] = "InClosingTagName", e[e.AfterClosingTagName = 7] = "AfterClosingTagName", e[e.BeforeAttributeName = 8] = "BeforeAttributeName", e[e.InAttributeName = 9] = "InAttributeName", e[e.AfterAttributeName = 10] = "AfterAttributeName", e[e.BeforeAttributeValue = 11] = "BeforeAttributeValue", e[e.InAttributeValueDq = 12] = "InAttributeValueDq", e[e.InAttributeValueSq = 13] = "InAttributeValueSq", e[e.InAttributeValueNq = 14] = "InAttributeValueNq", e[e.BeforeDeclaration = 15] = "BeforeDeclaration", e[e.InDeclaration = 16] = "InDeclaration", e[e.InProcessingInstruction = 17] = "InProcessingInstruction", e[e.BeforeComment = 18] = "BeforeComment", e[e.CDATASequence = 19] = "CDATASequence", e[e.InSpecialComment = 20] = "InSpecialComment", e[e.InCommentLike = 21] = "InCommentLike", e[e.BeforeSpecialS = 22] = "BeforeSpecialS", e[e.BeforeSpecialT = 23] = "BeforeSpecialT", e[e.SpecialStartSequence = 24] = "SpecialStartSequence", e[e.InSpecialTag = 25] = "InSpecialTag", e[e.InEntity = 26] = "InEntity";
})(q || (q = {}));
function An(e) {
	return e === K.Space || e === K.NewLine || e === K.Tab || e === K.FormFeed || e === K.CarriageReturn;
}
function jn(e) {
	return e === K.Slash || e === K.Gt || An(e);
}
function Mn(e) {
	return e >= K.LowerA && e <= K.LowerZ || e >= K.UpperA && e <= K.UpperZ;
}
var Nn;
(function(e) {
	e[e.NoValue = 0] = "NoValue", e[e.Unquoted = 1] = "Unquoted", e[e.Single = 2] = "Single", e[e.Double = 3] = "Double";
})(Nn || (Nn = {}));
var Pn = {
	Cdata: new Uint8Array([
		67,
		68,
		65,
		84,
		65,
		91
	]),
	CdataEnd: new Uint8Array([
		93,
		93,
		62
	]),
	CommentEnd: new Uint8Array([
		45,
		45,
		62
	]),
	ScriptEnd: new Uint8Array([
		60,
		47,
		115,
		99,
		114,
		105,
		112,
		116
	]),
	StyleEnd: new Uint8Array([
		60,
		47,
		115,
		116,
		121,
		108,
		101
	]),
	TitleEnd: new Uint8Array([
		60,
		47,
		116,
		105,
		116,
		108,
		101
	]),
	TextareaEnd: new Uint8Array([
		60,
		47,
		116,
		101,
		120,
		116,
		97,
		114,
		101,
		97
	]),
	XmpEnd: new Uint8Array([
		60,
		47,
		120,
		109,
		112
	])
}, Fn = class {
	constructor({ xmlMode: e = !1, decodeEntities: t = !0 }, n) {
		this.cbs = n, this.state = q.Text, this.buffer = "", this.sectionStart = 0, this.index = 0, this.entityStart = 0, this.baseState = q.Text, this.isSpecial = !1, this.running = !0, this.offset = 0, this.currentSequence = void 0, this.sequenceIndex = 0, this.xmlMode = e, this.decodeEntities = t, this.entityDecoder = new On(e ? vn : _n, (e, t) => this.emitCodePoint(e, t));
	}
	reset() {
		this.state = q.Text, this.buffer = "", this.sectionStart = 0, this.index = 0, this.baseState = q.Text, this.currentSequence = void 0, this.running = !0, this.offset = 0;
	}
	write(e) {
		this.offset += this.buffer.length, this.buffer = e, this.parse();
	}
	end() {
		this.running && this.finish();
	}
	pause() {
		this.running = !1;
	}
	resume() {
		this.running = !0, this.index < this.buffer.length + this.offset && this.parse();
	}
	stateText(e) {
		e === K.Lt || !this.decodeEntities && this.fastForwardTo(K.Lt) ? (this.index > this.sectionStart && this.cbs.ontext(this.sectionStart, this.index), this.state = q.BeforeTagName, this.sectionStart = this.index) : this.decodeEntities && e === K.Amp && this.startEntity();
	}
	stateSpecialStartSequence(e) {
		let t = this.sequenceIndex === this.currentSequence.length;
		if (!(t ? jn(e) : (e | 32) === this.currentSequence[this.sequenceIndex])) this.isSpecial = !1;
		else if (!t) {
			this.sequenceIndex++;
			return;
		}
		this.sequenceIndex = 0, this.state = q.InTagName, this.stateInTagName(e);
	}
	stateInSpecialTag(e) {
		if (this.sequenceIndex === this.currentSequence.length) {
			if (e === K.Gt || An(e)) {
				let t = this.index - this.currentSequence.length;
				if (this.sectionStart < t) {
					let e = this.index;
					this.index = t, this.cbs.ontext(this.sectionStart, t), this.index = e;
				}
				this.isSpecial = !1, this.sectionStart = t + 2, this.stateInClosingTagName(e);
				return;
			}
			this.sequenceIndex = 0;
		}
		(e | 32) === this.currentSequence[this.sequenceIndex] ? this.sequenceIndex += 1 : this.sequenceIndex === 0 ? this.currentSequence === Pn.TitleEnd ? this.decodeEntities && e === K.Amp && this.startEntity() : this.fastForwardTo(K.Lt) && (this.sequenceIndex = 1) : this.sequenceIndex = Number(e === K.Lt);
	}
	stateCDATASequence(e) {
		e === Pn.Cdata[this.sequenceIndex] ? ++this.sequenceIndex === Pn.Cdata.length && (this.state = q.InCommentLike, this.currentSequence = Pn.CdataEnd, this.sequenceIndex = 0, this.sectionStart = this.index + 1) : (this.sequenceIndex = 0, this.state = q.InDeclaration, this.stateInDeclaration(e));
	}
	fastForwardTo(e) {
		for (; ++this.index < this.buffer.length + this.offset;) if (this.buffer.charCodeAt(this.index - this.offset) === e) return !0;
		return this.index = this.buffer.length + this.offset - 1, !1;
	}
	stateInCommentLike(e) {
		e === this.currentSequence[this.sequenceIndex] ? ++this.sequenceIndex === this.currentSequence.length && (this.currentSequence === Pn.CdataEnd ? this.cbs.oncdata(this.sectionStart, this.index, 2) : this.cbs.oncomment(this.sectionStart, this.index, 2), this.sequenceIndex = 0, this.sectionStart = this.index + 1, this.state = q.Text) : this.sequenceIndex === 0 ? this.fastForwardTo(this.currentSequence[0]) && (this.sequenceIndex = 1) : e !== this.currentSequence[this.sequenceIndex - 1] && (this.sequenceIndex = 0);
	}
	isTagStartChar(e) {
		return this.xmlMode ? !jn(e) : Mn(e);
	}
	startSpecial(e, t) {
		this.isSpecial = !0, this.currentSequence = e, this.sequenceIndex = t, this.state = q.SpecialStartSequence;
	}
	stateBeforeTagName(e) {
		if (e === K.ExclamationMark) this.state = q.BeforeDeclaration, this.sectionStart = this.index + 1;
		else if (e === K.Questionmark) this.state = q.InProcessingInstruction, this.sectionStart = this.index + 1;
		else if (this.isTagStartChar(e)) {
			let t = e | 32;
			this.sectionStart = this.index, this.xmlMode ? this.state = q.InTagName : t === Pn.ScriptEnd[2] ? this.state = q.BeforeSpecialS : t === Pn.TitleEnd[2] || t === Pn.XmpEnd[2] ? this.state = q.BeforeSpecialT : this.state = q.InTagName;
		} else e === K.Slash ? this.state = q.BeforeClosingTagName : (this.state = q.Text, this.stateText(e));
	}
	stateInTagName(e) {
		jn(e) && (this.cbs.onopentagname(this.sectionStart, this.index), this.sectionStart = -1, this.state = q.BeforeAttributeName, this.stateBeforeAttributeName(e));
	}
	stateBeforeClosingTagName(e) {
		An(e) || (e === K.Gt ? this.state = q.Text : (this.state = this.isTagStartChar(e) ? q.InClosingTagName : q.InSpecialComment, this.sectionStart = this.index));
	}
	stateInClosingTagName(e) {
		(e === K.Gt || An(e)) && (this.cbs.onclosetag(this.sectionStart, this.index), this.sectionStart = -1, this.state = q.AfterClosingTagName, this.stateAfterClosingTagName(e));
	}
	stateAfterClosingTagName(e) {
		(e === K.Gt || this.fastForwardTo(K.Gt)) && (this.state = q.Text, this.sectionStart = this.index + 1);
	}
	stateBeforeAttributeName(e) {
		e === K.Gt ? (this.cbs.onopentagend(this.index), this.isSpecial ? (this.state = q.InSpecialTag, this.sequenceIndex = 0) : this.state = q.Text, this.sectionStart = this.index + 1) : e === K.Slash ? this.state = q.InSelfClosingTag : An(e) || (this.state = q.InAttributeName, this.sectionStart = this.index);
	}
	stateInSelfClosingTag(e) {
		e === K.Gt ? (this.cbs.onselfclosingtag(this.index), this.state = q.Text, this.sectionStart = this.index + 1, this.isSpecial = !1) : An(e) || (this.state = q.BeforeAttributeName, this.stateBeforeAttributeName(e));
	}
	stateInAttributeName(e) {
		(e === K.Eq || jn(e)) && (this.cbs.onattribname(this.sectionStart, this.index), this.sectionStart = this.index, this.state = q.AfterAttributeName, this.stateAfterAttributeName(e));
	}
	stateAfterAttributeName(e) {
		e === K.Eq ? this.state = q.BeforeAttributeValue : e === K.Slash || e === K.Gt ? (this.cbs.onattribend(Nn.NoValue, this.sectionStart), this.sectionStart = -1, this.state = q.BeforeAttributeName, this.stateBeforeAttributeName(e)) : An(e) || (this.cbs.onattribend(Nn.NoValue, this.sectionStart), this.state = q.InAttributeName, this.sectionStart = this.index);
	}
	stateBeforeAttributeValue(e) {
		e === K.DoubleQuote ? (this.state = q.InAttributeValueDq, this.sectionStart = this.index + 1) : e === K.SingleQuote ? (this.state = q.InAttributeValueSq, this.sectionStart = this.index + 1) : An(e) || (this.sectionStart = this.index, this.state = q.InAttributeValueNq, this.stateInAttributeValueNoQuotes(e));
	}
	handleInAttributeValue(e, t) {
		e === t || !this.decodeEntities && this.fastForwardTo(t) ? (this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = -1, this.cbs.onattribend(t === K.DoubleQuote ? Nn.Double : Nn.Single, this.index + 1), this.state = q.BeforeAttributeName) : this.decodeEntities && e === K.Amp && this.startEntity();
	}
	stateInAttributeValueDoubleQuotes(e) {
		this.handleInAttributeValue(e, K.DoubleQuote);
	}
	stateInAttributeValueSingleQuotes(e) {
		this.handleInAttributeValue(e, K.SingleQuote);
	}
	stateInAttributeValueNoQuotes(e) {
		An(e) || e === K.Gt ? (this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = -1, this.cbs.onattribend(Nn.Unquoted, this.index), this.state = q.BeforeAttributeName, this.stateBeforeAttributeName(e)) : this.decodeEntities && e === K.Amp && this.startEntity();
	}
	stateBeforeDeclaration(e) {
		e === K.OpeningSquareBracket ? (this.state = q.CDATASequence, this.sequenceIndex = 0) : this.state = e === K.Dash ? q.BeforeComment : q.InDeclaration;
	}
	stateInDeclaration(e) {
		(e === K.Gt || this.fastForwardTo(K.Gt)) && (this.cbs.ondeclaration(this.sectionStart, this.index), this.state = q.Text, this.sectionStart = this.index + 1);
	}
	stateInProcessingInstruction(e) {
		(e === K.Gt || this.fastForwardTo(K.Gt)) && (this.cbs.onprocessinginstruction(this.sectionStart, this.index), this.state = q.Text, this.sectionStart = this.index + 1);
	}
	stateBeforeComment(e) {
		e === K.Dash ? (this.state = q.InCommentLike, this.currentSequence = Pn.CommentEnd, this.sequenceIndex = 2, this.sectionStart = this.index + 1) : this.state = q.InDeclaration;
	}
	stateInSpecialComment(e) {
		(e === K.Gt || this.fastForwardTo(K.Gt)) && (this.cbs.oncomment(this.sectionStart, this.index, 0), this.state = q.Text, this.sectionStart = this.index + 1);
	}
	stateBeforeSpecialS(e) {
		let t = e | 32;
		t === Pn.ScriptEnd[3] ? this.startSpecial(Pn.ScriptEnd, 4) : t === Pn.StyleEnd[3] ? this.startSpecial(Pn.StyleEnd, 4) : (this.state = q.InTagName, this.stateInTagName(e));
	}
	stateBeforeSpecialT(e) {
		switch (e | 32) {
			case Pn.TitleEnd[3]:
				this.startSpecial(Pn.TitleEnd, 4);
				break;
			case Pn.TextareaEnd[3]:
				this.startSpecial(Pn.TextareaEnd, 4);
				break;
			case Pn.XmpEnd[3]:
				this.startSpecial(Pn.XmpEnd, 4);
				break;
			default: this.state = q.InTagName, this.stateInTagName(e);
		}
	}
	startEntity() {
		this.baseState = this.state, this.state = q.InEntity, this.entityStart = this.index, this.entityDecoder.startEntity(this.xmlMode ? Dn.Strict : this.baseState === q.Text || this.baseState === q.InSpecialTag ? Dn.Legacy : Dn.Attribute);
	}
	stateInEntity() {
		let e = this.index - this.offset, t = this.entityDecoder.write(this.buffer, e);
		if (t >= 0) this.state = this.baseState, t === 0 && --this.index;
		else {
			if (e < this.buffer.length && this.buffer.charCodeAt(e) === K.Amp) {
				this.state = this.baseState, --this.index;
				return;
			}
			this.index = this.offset + this.buffer.length - 1;
		}
	}
	cleanup() {
		this.running && this.sectionStart !== this.index && (this.state === q.Text || this.state === q.InSpecialTag && this.sequenceIndex === 0 ? (this.cbs.ontext(this.sectionStart, this.index), this.sectionStart = this.index) : (this.state === q.InAttributeValueDq || this.state === q.InAttributeValueSq || this.state === q.InAttributeValueNq) && (this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = this.index));
	}
	shouldContinue() {
		return this.index < this.buffer.length + this.offset && this.running;
	}
	parse() {
		for (; this.shouldContinue();) {
			let e = this.buffer.charCodeAt(this.index - this.offset);
			switch (this.state) {
				case q.Text:
					this.stateText(e);
					break;
				case q.SpecialStartSequence:
					this.stateSpecialStartSequence(e);
					break;
				case q.InSpecialTag:
					this.stateInSpecialTag(e);
					break;
				case q.CDATASequence:
					this.stateCDATASequence(e);
					break;
				case q.InAttributeValueDq:
					this.stateInAttributeValueDoubleQuotes(e);
					break;
				case q.InAttributeName:
					this.stateInAttributeName(e);
					break;
				case q.InCommentLike:
					this.stateInCommentLike(e);
					break;
				case q.InSpecialComment:
					this.stateInSpecialComment(e);
					break;
				case q.BeforeAttributeName:
					this.stateBeforeAttributeName(e);
					break;
				case q.InTagName:
					this.stateInTagName(e);
					break;
				case q.InClosingTagName:
					this.stateInClosingTagName(e);
					break;
				case q.BeforeTagName:
					this.stateBeforeTagName(e);
					break;
				case q.AfterAttributeName:
					this.stateAfterAttributeName(e);
					break;
				case q.InAttributeValueSq:
					this.stateInAttributeValueSingleQuotes(e);
					break;
				case q.BeforeAttributeValue:
					this.stateBeforeAttributeValue(e);
					break;
				case q.BeforeClosingTagName:
					this.stateBeforeClosingTagName(e);
					break;
				case q.AfterClosingTagName:
					this.stateAfterClosingTagName(e);
					break;
				case q.BeforeSpecialS:
					this.stateBeforeSpecialS(e);
					break;
				case q.BeforeSpecialT:
					this.stateBeforeSpecialT(e);
					break;
				case q.InAttributeValueNq:
					this.stateInAttributeValueNoQuotes(e);
					break;
				case q.InSelfClosingTag:
					this.stateInSelfClosingTag(e);
					break;
				case q.InDeclaration:
					this.stateInDeclaration(e);
					break;
				case q.BeforeDeclaration:
					this.stateBeforeDeclaration(e);
					break;
				case q.BeforeComment:
					this.stateBeforeComment(e);
					break;
				case q.InProcessingInstruction:
					this.stateInProcessingInstruction(e);
					break;
				case q.InEntity:
					this.stateInEntity();
					break;
			}
			this.index++;
		}
		this.cleanup();
	}
	finish() {
		this.state === q.InEntity && (this.entityDecoder.end(), this.state = this.baseState), this.handleTrailingData(), this.cbs.onend();
	}
	handleTrailingData() {
		let e = this.buffer.length + this.offset;
		this.sectionStart >= e || (this.state === q.InCommentLike ? this.currentSequence === Pn.CdataEnd ? this.cbs.oncdata(this.sectionStart, e, 0) : this.cbs.oncomment(this.sectionStart, e, 0) : this.state === q.InTagName || this.state === q.BeforeAttributeName || this.state === q.BeforeAttributeValue || this.state === q.AfterAttributeName || this.state === q.InAttributeName || this.state === q.InAttributeValueSq || this.state === q.InAttributeValueDq || this.state === q.InAttributeValueNq || this.state === q.InClosingTagName || this.cbs.ontext(this.sectionStart, e));
	}
	emitCodePoint(e, t) {
		this.baseState !== q.Text && this.baseState !== q.InSpecialTag ? (this.sectionStart < this.entityStart && this.cbs.onattribdata(this.sectionStart, this.entityStart), this.sectionStart = this.entityStart + t, this.index = this.sectionStart - 1, this.cbs.onattribentity(e)) : (this.sectionStart < this.entityStart && this.cbs.ontext(this.sectionStart, this.entityStart), this.sectionStart = this.entityStart + t, this.index = this.sectionStart - 1, this.cbs.ontextentity(e, this.sectionStart));
	}
}, In = new Set([
	"input",
	"option",
	"optgroup",
	"select",
	"button",
	"datalist",
	"textarea"
]), Ln = new Set(["p"]), Rn = new Set(["thead", "tbody"]), zn = new Set(["dd", "dt"]), Bn = new Set(["rt", "rp"]), Vn = new Map([
	["tr", new Set([
		"tr",
		"th",
		"td"
	])],
	["th", new Set(["th"])],
	["td", new Set([
		"thead",
		"th",
		"td"
	])],
	["body", new Set([
		"head",
		"link",
		"script"
	])],
	["li", new Set(["li"])],
	["p", Ln],
	["h1", Ln],
	["h2", Ln],
	["h3", Ln],
	["h4", Ln],
	["h5", Ln],
	["h6", Ln],
	["select", In],
	["input", In],
	["output", In],
	["button", In],
	["datalist", In],
	["textarea", In],
	["option", new Set(["option"])],
	["optgroup", new Set(["optgroup", "option"])],
	["dd", zn],
	["dt", zn],
	["address", Ln],
	["article", Ln],
	["aside", Ln],
	["blockquote", Ln],
	["details", Ln],
	["div", Ln],
	["dl", Ln],
	["fieldset", Ln],
	["figcaption", Ln],
	["figure", Ln],
	["footer", Ln],
	["form", Ln],
	["header", Ln],
	["hr", Ln],
	["main", Ln],
	["nav", Ln],
	["ol", Ln],
	["pre", Ln],
	["section", Ln],
	["table", Ln],
	["ul", Ln],
	["rt", Bn],
	["rp", Bn],
	["tbody", Rn],
	["tfoot", Rn]
]), Hn = new Set([
	"area",
	"base",
	"basefont",
	"br",
	"col",
	"command",
	"embed",
	"frame",
	"hr",
	"img",
	"input",
	"isindex",
	"keygen",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr"
]), Un = new Set(["math", "svg"]), Wn = new Set([
	"mi",
	"mo",
	"mn",
	"ms",
	"mtext",
	"annotation-xml",
	"foreignobject",
	"desc",
	"title"
]), Gn = /\s|\//, Kn = class {
	constructor(e, t = {}) {
		var n, r, i, a, o, s;
		this.options = t, this.startIndex = 0, this.endIndex = 0, this.openTagStart = 0, this.tagname = "", this.attribname = "", this.attribvalue = "", this.attribs = null, this.stack = [], this.buffers = [], this.bufferOffset = 0, this.writeIndex = 0, this.ended = !1, this.cbs = e == null ? {} : e, this.htmlMode = !this.options.xmlMode, this.lowerCaseTagNames = (n = t.lowerCaseTags) == null ? this.htmlMode : n, this.lowerCaseAttributeNames = (r = t.lowerCaseAttributeNames) == null ? this.htmlMode : r, this.recognizeSelfClosing = (i = t.recognizeSelfClosing) == null ? !this.htmlMode : i, this.tokenizer = new ((a = t.Tokenizer) == null ? Fn : a)(this.options, this), this.foreignContext = [!this.htmlMode], (s = (o = this.cbs).onparserinit) == null || s.call(o, this);
	}
	ontext(e, t) {
		var n, r;
		let i = this.getSlice(e, t);
		this.endIndex = t - 1, (r = (n = this.cbs).ontext) == null || r.call(n, i), this.startIndex = t;
	}
	ontextentity(e, t) {
		var n, r;
		this.endIndex = t - 1, (r = (n = this.cbs).ontext) == null || r.call(n, mn(e)), this.startIndex = t;
	}
	isVoidElement(e) {
		return this.htmlMode && Hn.has(e);
	}
	onopentagname(e, t) {
		this.endIndex = t;
		let n = this.getSlice(e, t);
		this.lowerCaseTagNames && (n = n.toLowerCase()), this.emitOpenTag(n);
	}
	emitOpenTag(e) {
		var t, n, r, i;
		this.openTagStart = this.startIndex, this.tagname = e;
		let a = this.htmlMode && Vn.get(e);
		if (a) for (; this.stack.length > 0 && a.has(this.stack[0]);) {
			let e = this.stack.shift();
			(n = (t = this.cbs).onclosetag) == null || n.call(t, e, !0);
		}
		this.isVoidElement(e) || (this.stack.unshift(e), this.htmlMode && (Un.has(e) ? this.foreignContext.unshift(!0) : Wn.has(e) && this.foreignContext.unshift(!1))), (i = (r = this.cbs).onopentagname) == null || i.call(r, e), this.cbs.onopentag && (this.attribs = {});
	}
	endOpenTag(e) {
		var t, n;
		this.startIndex = this.openTagStart, this.attribs && ((n = (t = this.cbs).onopentag) == null || n.call(t, this.tagname, this.attribs, e), this.attribs = null), this.cbs.onclosetag && this.isVoidElement(this.tagname) && this.cbs.onclosetag(this.tagname, !0), this.tagname = "";
	}
	onopentagend(e) {
		this.endIndex = e, this.endOpenTag(!1), this.startIndex = e + 1;
	}
	onclosetag(e, t) {
		var n, r, i, a, o, s, c, l;
		this.endIndex = t;
		let u = this.getSlice(e, t);
		if (this.lowerCaseTagNames && (u = u.toLowerCase()), this.htmlMode && (Un.has(u) || Wn.has(u)) && this.foreignContext.shift(), this.isVoidElement(u)) this.htmlMode && u === "br" && ((a = (i = this.cbs).onopentagname) == null || a.call(i, "br"), (s = (o = this.cbs).onopentag) == null || s.call(o, "br", {}, !0), (l = (c = this.cbs).onclosetag) == null || l.call(c, "br", !1));
		else {
			let e = this.stack.indexOf(u);
			if (e !== -1) for (let t = 0; t <= e; t++) {
				let i = this.stack.shift();
				(r = (n = this.cbs).onclosetag) == null || r.call(n, i, t !== e);
			}
			else this.htmlMode && u === "p" && (this.emitOpenTag("p"), this.closeCurrentTag(!0));
		}
		this.startIndex = t + 1;
	}
	onselfclosingtag(e) {
		this.endIndex = e, this.recognizeSelfClosing || this.foreignContext[0] ? (this.closeCurrentTag(!1), this.startIndex = e + 1) : this.onopentagend(e);
	}
	closeCurrentTag(e) {
		var t, n;
		let r = this.tagname;
		this.endOpenTag(e), this.stack[0] === r && ((n = (t = this.cbs).onclosetag) == null || n.call(t, r, !e), this.stack.shift());
	}
	onattribname(e, t) {
		this.startIndex = e;
		let n = this.getSlice(e, t);
		this.attribname = this.lowerCaseAttributeNames ? n.toLowerCase() : n;
	}
	onattribdata(e, t) {
		this.attribvalue += this.getSlice(e, t);
	}
	onattribentity(e) {
		this.attribvalue += mn(e);
	}
	onattribend(e, t) {
		var n, r;
		this.endIndex = t, (r = (n = this.cbs).onattribute) == null || r.call(n, this.attribname, this.attribvalue, e === Nn.Double ? "\"" : e === Nn.Single ? "'" : e === Nn.NoValue ? void 0 : null), this.attribs && !Object.prototype.hasOwnProperty.call(this.attribs, this.attribname) && (this.attribs[this.attribname] = this.attribvalue), this.attribvalue = "";
	}
	getInstructionName(e) {
		let t = e.search(Gn), n = t < 0 ? e : e.substr(0, t);
		return this.lowerCaseTagNames && (n = n.toLowerCase()), n;
	}
	ondeclaration(e, t) {
		this.endIndex = t;
		let n = this.getSlice(e, t);
		if (this.cbs.onprocessinginstruction) {
			let e = this.getInstructionName(n);
			this.cbs.onprocessinginstruction(`!${e}`, `!${n}`);
		}
		this.startIndex = t + 1;
	}
	onprocessinginstruction(e, t) {
		this.endIndex = t;
		let n = this.getSlice(e, t);
		if (this.cbs.onprocessinginstruction) {
			let e = this.getInstructionName(n);
			this.cbs.onprocessinginstruction(`?${e}`, `?${n}`);
		}
		this.startIndex = t + 1;
	}
	oncomment(e, t, n) {
		var r, i, a, o;
		this.endIndex = t, (i = (r = this.cbs).oncomment) == null || i.call(r, this.getSlice(e, t - n)), (o = (a = this.cbs).oncommentend) == null || o.call(a), this.startIndex = t + 1;
	}
	oncdata(e, t, n) {
		var r, i, a, o, s, c, l, u, d, f;
		this.endIndex = t;
		let p = this.getSlice(e, t - n);
		!this.htmlMode || this.options.recognizeCDATA ? ((i = (r = this.cbs).oncdatastart) == null || i.call(r), (o = (a = this.cbs).ontext) == null || o.call(a, p), (c = (s = this.cbs).oncdataend) == null || c.call(s)) : ((u = (l = this.cbs).oncomment) == null || u.call(l, `[CDATA[${p}]]`), (f = (d = this.cbs).oncommentend) == null || f.call(d)), this.startIndex = t + 1;
	}
	onend() {
		var e, t;
		if (this.cbs.onclosetag) {
			this.endIndex = this.startIndex;
			for (let e = 0; e < this.stack.length; e++) this.cbs.onclosetag(this.stack[e], !0);
		}
		(t = (e = this.cbs).onend) == null || t.call(e);
	}
	reset() {
		var e, t, n, r;
		(t = (e = this.cbs).onreset) == null || t.call(e), this.tokenizer.reset(), this.tagname = "", this.attribname = "", this.attribs = null, this.stack.length = 0, this.startIndex = 0, this.endIndex = 0, (r = (n = this.cbs).onparserinit) == null || r.call(n, this), this.buffers.length = 0, this.foreignContext.length = 0, this.foreignContext.unshift(!this.htmlMode), this.bufferOffset = 0, this.writeIndex = 0, this.ended = !1;
	}
	parseComplete(e) {
		this.reset(), this.end(e);
	}
	getSlice(e, t) {
		for (; e - this.bufferOffset >= this.buffers[0].length;) this.shiftBuffer();
		let n = this.buffers[0].slice(e - this.bufferOffset, t - this.bufferOffset);
		for (; t - this.bufferOffset > this.buffers[0].length;) this.shiftBuffer(), n += this.buffers[0].slice(0, t - this.bufferOffset);
		return n;
	}
	shiftBuffer() {
		this.bufferOffset += this.buffers[0].length, this.writeIndex--, this.buffers.shift();
	}
	write(e) {
		var t, n;
		if (this.ended) {
			(n = (t = this.cbs).onerror) == null || n.call(t, /* @__PURE__ */ Error(".write() after done!"));
			return;
		}
		this.buffers.push(e), this.tokenizer.running && (this.tokenizer.write(e), this.writeIndex++);
	}
	end(e) {
		var t, n;
		if (this.ended) {
			(n = (t = this.cbs).onerror) == null || n.call(t, /* @__PURE__ */ Error(".end() after done!"));
			return;
		}
		e && this.write(e), this.ended = !0, this.tokenizer.end();
	}
	pause() {
		this.tokenizer.pause();
	}
	resume() {
		for (this.tokenizer.resume(); this.tokenizer.running && this.writeIndex < this.buffers.length;) this.tokenizer.write(this.buffers[this.writeIndex++]);
		this.ended && this.tokenizer.end();
	}
	parseChunk(e) {
		this.write(e);
	}
	done(e) {
		this.end(e);
	}
}, qn = /* @__PURE__ */ c({
	CDATA: () => nr,
	Comment: () => Qn,
	Directive: () => Zn,
	Doctype: () => rr,
	ElementType: () => J,
	Root: () => Yn,
	Script: () => $n,
	Style: () => er,
	Tag: () => tr,
	Text: () => Xn,
	isTag: () => Jn
}), J;
(function(e) {
	e.Root = "root", e.Text = "text", e.Directive = "directive", e.Comment = "comment", e.Script = "script", e.Style = "style", e.Tag = "tag", e.CDATA = "cdata", e.Doctype = "doctype";
})(J || (J = {}));
function Jn(e) {
	return e.type === J.Tag || e.type === J.Script || e.type === J.Style;
}
var Yn = J.Root, Xn = J.Text, Zn = J.Directive, Qn = J.Comment, $n = J.Script, er = J.Style, tr = J.Tag, nr = J.CDATA, rr = J.Doctype, ir = class {
	constructor() {
		this.parent = null, this.prev = null, this.next = null, this.startIndex = null, this.endIndex = null;
	}
	get parentNode() {
		return this.parent;
	}
	set parentNode(e) {
		this.parent = e;
	}
	get previousSibling() {
		return this.prev;
	}
	set previousSibling(e) {
		this.prev = e;
	}
	get nextSibling() {
		return this.next;
	}
	set nextSibling(e) {
		this.next = e;
	}
	cloneNode(e = !1) {
		return br(this, e);
	}
}, ar = class extends ir {
	constructor(e) {
		super(), this.data = e;
	}
	get nodeValue() {
		return this.data;
	}
	set nodeValue(e) {
		this.data = e;
	}
}, or = class extends ar {
	constructor() {
		super(...arguments), this.type = J.Text;
	}
	get nodeType() {
		return 3;
	}
}, sr = class extends ar {
	constructor() {
		super(...arguments), this.type = J.Comment;
	}
	get nodeType() {
		return 8;
	}
}, cr = class extends ar {
	constructor(e, t) {
		super(t), this.name = e, this.type = J.Directive;
	}
	get nodeType() {
		return 1;
	}
}, lr = class extends ir {
	constructor(e) {
		super(), this.children = e;
	}
	get firstChild() {
		var e;
		return (e = this.children[0]) == null ? null : e;
	}
	get lastChild() {
		return this.children.length > 0 ? this.children[this.children.length - 1] : null;
	}
	get childNodes() {
		return this.children;
	}
	set childNodes(e) {
		this.children = e;
	}
}, ur = class extends lr {
	constructor() {
		super(...arguments), this.type = J.CDATA;
	}
	get nodeType() {
		return 4;
	}
}, dr = class extends lr {
	constructor() {
		super(...arguments), this.type = J.Root;
	}
	get nodeType() {
		return 9;
	}
}, fr = class extends lr {
	constructor(e, t, n = [], r = e === "script" ? J.Script : e === "style" ? J.Style : J.Tag) {
		super(n), this.name = e, this.attribs = t, this.type = r;
	}
	get nodeType() {
		return 1;
	}
	get tagName() {
		return this.name;
	}
	set tagName(e) {
		this.name = e;
	}
	get attributes() {
		return Object.keys(this.attribs).map((e) => {
			var t, n;
			return {
				name: e,
				value: this.attribs[e],
				namespace: (t = this["x-attribsNamespace"]) == null ? void 0 : t[e],
				prefix: (n = this["x-attribsPrefix"]) == null ? void 0 : n[e]
			};
		});
	}
};
function pr(e) {
	return Jn(e);
}
function mr(e) {
	return e.type === J.CDATA;
}
function hr(e) {
	return e.type === J.Text;
}
function gr(e) {
	return e.type === J.Comment;
}
function _r(e) {
	return e.type === J.Directive;
}
function vr(e) {
	return e.type === J.Root;
}
function yr(e) {
	return Object.prototype.hasOwnProperty.call(e, "children");
}
function br(e, t = !1) {
	let n;
	if (hr(e)) n = new or(e.data);
	else if (gr(e)) n = new sr(e.data);
	else if (pr(e)) {
		let r = t ? xr(e.children) : [], i = new fr(e.name, { ...e.attribs }, r);
		r.forEach((e) => e.parent = i), e.namespace != null && (i.namespace = e.namespace), e["x-attribsNamespace"] && (i["x-attribsNamespace"] = { ...e["x-attribsNamespace"] }), e["x-attribsPrefix"] && (i["x-attribsPrefix"] = { ...e["x-attribsPrefix"] }), n = i;
	} else if (mr(e)) {
		let r = t ? xr(e.children) : [], i = new ur(r);
		r.forEach((e) => e.parent = i), n = i;
	} else if (vr(e)) {
		let r = t ? xr(e.children) : [], i = new dr(r);
		r.forEach((e) => e.parent = i), e["x-mode"] && (i["x-mode"] = e["x-mode"]), n = i;
	} else if (_r(e)) {
		let t = new cr(e.name, e.data);
		e["x-name"] != null && (t["x-name"] = e["x-name"], t["x-publicId"] = e["x-publicId"], t["x-systemId"] = e["x-systemId"]), n = t;
	} else throw Error(`Not implemented yet: ${e.type}`);
	return n.startIndex = e.startIndex, n.endIndex = e.endIndex, e.sourceCodeLocation != null && (n.sourceCodeLocation = e.sourceCodeLocation), n;
}
function xr(e) {
	let t = e.map((e) => br(e, !0));
	for (let e = 1; e < t.length; e++) t[e].prev = t[e - 1], t[e - 1].next = t[e];
	return t;
}
//#endregion
//#region node_modules/.pnpm/domhandler@5.0.3/node_modules/domhandler/lib/esm/index.js
var Sr = {
	withStartIndices: !1,
	withEndIndices: !1,
	xmlMode: !1
}, Cr = class {
	constructor(e, t, n) {
		this.dom = [], this.root = new dr(this.dom), this.done = !1, this.tagStack = [this.root], this.lastNode = null, this.parser = null, typeof t == "function" && (n = t, t = Sr), typeof e == "object" && (t = e, e = void 0), this.callback = e == null ? null : e, this.options = t == null ? Sr : t, this.elementCB = n == null ? null : n;
	}
	onparserinit(e) {
		this.parser = e;
	}
	onreset() {
		this.dom = [], this.root = new dr(this.dom), this.done = !1, this.tagStack = [this.root], this.lastNode = null, this.parser = null;
	}
	onend() {
		this.done || (this.done = !0, this.parser = null, this.handleCallback(null));
	}
	onerror(e) {
		this.handleCallback(e);
	}
	onclosetag() {
		this.lastNode = null;
		let e = this.tagStack.pop();
		this.options.withEndIndices && (e.endIndex = this.parser.endIndex), this.elementCB && this.elementCB(e);
	}
	onopentag(e, t) {
		let n = new fr(e, t, void 0, this.options.xmlMode ? J.Tag : void 0);
		this.addNode(n), this.tagStack.push(n);
	}
	ontext(e) {
		let { lastNode: t } = this;
		if (t && t.type === J.Text) t.data += e, this.options.withEndIndices && (t.endIndex = this.parser.endIndex);
		else {
			let t = new or(e);
			this.addNode(t), this.lastNode = t;
		}
	}
	oncomment(e) {
		if (this.lastNode && this.lastNode.type === J.Comment) {
			this.lastNode.data += e;
			return;
		}
		let t = new sr(e);
		this.addNode(t), this.lastNode = t;
	}
	oncommentend() {
		this.lastNode = null;
	}
	oncdatastart() {
		let e = new or(""), t = new ur([e]);
		this.addNode(t), e.parent = t, this.lastNode = e;
	}
	oncdataend() {
		this.lastNode = null;
	}
	onprocessinginstruction(e, t) {
		let n = new cr(e, t);
		this.addNode(n);
	}
	handleCallback(e) {
		if (typeof this.callback == "function") this.callback(e, this.dom);
		else if (e) throw e;
	}
	addNode(e) {
		let t = this.tagStack[this.tagStack.length - 1], n = t.children[t.children.length - 1];
		this.options.withStartIndices && (e.startIndex = this.parser.startIndex), this.options.withEndIndices && (e.endIndex = this.parser.endIndex), t.children.push(e), n && (e.prev = n, n.next = e), e.parent = t, this.lastNode = null;
	}
};
//#endregion
//#region node_modules/.pnpm/entities@4.2.0/node_modules/entities/lib/esm/encode-trie.js
function wr(e) {
	return (e & 64512) == 55296;
}
var Tr = String.prototype.codePointAt == null ? (e, t) => wr(e.charCodeAt(t)) ? (e.charCodeAt(t) - 55296) * 1024 + e.charCodeAt(t + 1) - 56320 + 65536 : e.charCodeAt(t) : (e, t) => e.codePointAt(t), Er = /["&'<>$\x80-\uFFFF]/g, Dr = new Map([
	[34, "&quot;"],
	[38, "&amp;"],
	[39, "&apos;"],
	[60, "&lt;"],
	[62, "&gt;"]
]);
function Or(e) {
	let t = "", n = 0, r;
	for (; (r = Er.exec(e)) !== null;) {
		let i = r.index, a = e.charCodeAt(i), o = Dr.get(a);
		o === void 0 ? (t += `${e.substring(n, i)}&#x${Tr(e, i).toString(16)};`, n = Er.lastIndex += Number((a & 65408) == 55296)) : (t += e.substring(n, i) + o, n = i + 1);
	}
	return t + e.substr(n);
}
function kr(e, t) {
	return function(n) {
		let r, i = 0, a = "";
		for (; r = e.exec(n);) i !== r.index && (a += n.substring(i, r.index)), a += t.get(r[0].charCodeAt(0)), i = r.index + 1;
		return a + n.substring(i);
	};
}
var Ar = kr(/["&\u00A0]/g, new Map([
	[34, "&quot;"],
	[38, "&amp;"],
	[160, "&nbsp;"]
])), jr = kr(/[&<>\u00A0]/g, new Map([
	[38, "&amp;"],
	[60, "&lt;"],
	[62, "&gt;"],
	[160, "&nbsp;"]
])), Mr = new Map((/* @__PURE__ */ "altGlyph.altGlyphDef.altGlyphItem.animateColor.animateMotion.animateTransform.clipPath.feBlend.feColorMatrix.feComponentTransfer.feComposite.feConvolveMatrix.feDiffuseLighting.feDisplacementMap.feDistantLight.feDropShadow.feFlood.feFuncA.feFuncB.feFuncG.feFuncR.feGaussianBlur.feImage.feMerge.feMergeNode.feMorphology.feOffset.fePointLight.feSpecularLighting.feSpotLight.feTile.feTurbulence.foreignObject.glyphRef.linearGradient.radialGradient.textPath".split(".")).map((e) => [e.toLowerCase(), e])), Nr = new Map((/* @__PURE__ */ "definitionURL.attributeName.attributeType.baseFrequency.baseProfile.calcMode.clipPathUnits.diffuseConstant.edgeMode.filterUnits.glyphRef.gradientTransform.gradientUnits.kernelMatrix.kernelUnitLength.keyPoints.keySplines.keyTimes.lengthAdjust.limitingConeAngle.markerHeight.markerUnits.markerWidth.maskContentUnits.maskUnits.numOctaves.pathLength.patternContentUnits.patternTransform.patternUnits.pointsAtX.pointsAtY.pointsAtZ.preserveAlpha.preserveAspectRatio.primitiveUnits.refX.refY.repeatCount.repeatDur.requiredExtensions.requiredFeatures.specularConstant.specularExponent.spreadMethod.startOffset.stdDeviation.stitchTiles.surfaceScale.systemLanguage.tableValues.targetX.targetY.textLength.viewBox.viewTarget.xChannelSelector.yChannelSelector.zoomAndPan".split(".")).map((e) => [e.toLowerCase(), e])), Pr = new Set([
	"style",
	"script",
	"xmp",
	"iframe",
	"noembed",
	"noframes",
	"plaintext",
	"noscript"
]);
function Fr(e) {
	return e.replace(/"/g, "&quot;");
}
function Ir(e, t) {
	var n;
	if (!e) return;
	let r = ((n = t.encodeEntities) == null ? t.decodeEntities : n) === !1 ? Fr : t.xmlMode || t.encodeEntities !== "utf8" ? Or : Ar;
	return Object.keys(e).map((n) => {
		var i, a;
		let o = (i = e[n]) == null ? "" : i;
		return t.xmlMode === "foreign" && (n = (a = Nr.get(n)) == null ? n : a), !t.emptyAttrs && !t.xmlMode && o === "" ? n : `${n}="${r(o)}"`;
	}).join(" ");
}
var Lr = new Set([
	"area",
	"base",
	"basefont",
	"br",
	"col",
	"command",
	"embed",
	"frame",
	"hr",
	"img",
	"input",
	"isindex",
	"keygen",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr"
]);
function Rr(e, t = {}) {
	let n = "length" in e ? e : [e], r = "";
	for (let e = 0; e < n.length; e++) r += zr(n[e], t);
	return r;
}
function zr(e, t) {
	switch (e.type) {
		case Yn: return Rr(e.children, t);
		case rr:
		case Zn: return Ur(e);
		case Qn: return Kr(e);
		case nr: return Gr(e);
		case $n:
		case er:
		case tr: return Hr(e, t);
		case Xn: return Wr(e, t);
	}
}
var Br = new Set([
	"mi",
	"mo",
	"mn",
	"ms",
	"mtext",
	"annotation-xml",
	"foreignObject",
	"desc",
	"title"
]), Vr = new Set(["svg", "math"]);
function Hr(e, t) {
	var n;
	t.xmlMode === "foreign" && (e.name = (n = Mr.get(e.name)) == null ? e.name : n, e.parent && Br.has(e.parent.name) && (t = {
		...t,
		xmlMode: !1
	})), !t.xmlMode && Vr.has(e.name) && (t = {
		...t,
		xmlMode: "foreign"
	});
	let r = `<${e.name}`, i = Ir(e.attribs, t);
	return i && (r += ` ${i}`), e.children.length === 0 && (t.xmlMode ? t.selfClosingTags !== !1 : t.selfClosingTags && Lr.has(e.name)) ? (t.xmlMode || (r += " "), r += "/>") : (r += ">", e.children.length > 0 && (r += Rr(e.children, t)), (t.xmlMode || !Lr.has(e.name)) && (r += `</${e.name}>`)), r;
}
function Ur(e) {
	return `<${e.data}>`;
}
function Wr(e, t) {
	var n;
	let r = e.data || "";
	return ((n = t.encodeEntities) == null ? t.decodeEntities : n) !== !1 && !(!t.xmlMode && e.parent && Pr.has(e.parent.name)) && (r = t.xmlMode || t.encodeEntities !== "utf8" ? Or(r) : jr(r)), r;
}
function Gr(e) {
	return `<![CDATA[${e.children[0].data}]]>`;
}
function Kr(e) {
	return `<!--${e.data}-->`;
}
//#endregion
//#region node_modules/.pnpm/domutils@3.2.2/node_modules/domutils/lib/esm/stringify.js
function qr(e, t) {
	return Rr(e, t);
}
function Jr(e, t) {
	return yr(e) ? e.children.map((e) => qr(e, t)).join("") : "";
}
function Yr(e) {
	return Array.isArray(e) ? e.map(Yr).join("") : pr(e) ? e.name === "br" ? "\n" : Yr(e.children) : mr(e) ? Yr(e.children) : hr(e) ? e.data : "";
}
function Xr(e) {
	return Array.isArray(e) ? e.map(Xr).join("") : yr(e) && !gr(e) ? Xr(e.children) : hr(e) ? e.data : "";
}
function Zr(e) {
	return Array.isArray(e) ? e.map(Zr).join("") : yr(e) && (e.type === J.Tag || mr(e)) ? Zr(e.children) : hr(e) ? e.data : "";
}
//#endregion
//#region node_modules/.pnpm/domutils@3.2.2/node_modules/domutils/lib/esm/traversal.js
function Qr(e) {
	return yr(e) ? e.children : [];
}
function $r(e) {
	return e.parent || null;
}
function ei(e) {
	let t = $r(e);
	if (t != null) return Qr(t);
	let n = [e], { prev: r, next: i } = e;
	for (; r != null;) n.unshift(r), {prev: r} = r;
	for (; i != null;) n.push(i), {next: i} = i;
	return n;
}
function ti(e, t) {
	var n;
	return (n = e.attribs) == null ? void 0 : n[t];
}
function ni(e, t) {
	return e.attribs != null && Object.prototype.hasOwnProperty.call(e.attribs, t) && e.attribs[t] != null;
}
function ri(e) {
	return e.name;
}
function ii(e) {
	let { next: t } = e;
	for (; t !== null && !pr(t);) ({next: t} = t);
	return t;
}
function ai(e) {
	let { prev: t } = e;
	for (; t !== null && !pr(t);) ({prev: t} = t);
	return t;
}
//#endregion
//#region node_modules/.pnpm/domutils@3.2.2/node_modules/domutils/lib/esm/manipulation.js
function oi(e) {
	if (e.prev && (e.prev.next = e.next), e.next && (e.next.prev = e.prev), e.parent) {
		let t = e.parent.children, n = t.lastIndexOf(e);
		n >= 0 && t.splice(n, 1);
	}
	e.next = null, e.prev = null, e.parent = null;
}
function si(e, t) {
	let n = t.prev = e.prev;
	n && (n.next = t);
	let r = t.next = e.next;
	r && (r.prev = t);
	let i = t.parent = e.parent;
	if (i) {
		let n = i.children;
		n[n.lastIndexOf(e)] = t, e.parent = null;
	}
}
function ci(e, t) {
	if (oi(t), t.next = null, t.parent = e, e.children.push(t) > 1) {
		let n = e.children[e.children.length - 2];
		n.next = t, t.prev = n;
	} else t.prev = null;
}
function li(e, t) {
	oi(t);
	let { parent: n } = e, r = e.next;
	if (t.next = r, t.prev = e, e.next = t, t.parent = n, r) {
		if (r.prev = t, n) {
			let e = n.children;
			e.splice(e.lastIndexOf(r), 0, t);
		}
	} else n && n.children.push(t);
}
function ui(e, t) {
	if (oi(t), t.parent = e, t.prev = null, e.children.unshift(t) !== 1) {
		let n = e.children[1];
		n.prev = t, t.next = n;
	} else t.next = null;
}
function di(e, t) {
	oi(t);
	let { parent: n } = e;
	if (n) {
		let r = n.children;
		r.splice(r.indexOf(e), 0, t);
	}
	e.prev && (e.prev.next = t), t.parent = n, t.prev = e.prev, t.next = e, e.prev = t;
}
//#endregion
//#region node_modules/.pnpm/domutils@3.2.2/node_modules/domutils/lib/esm/querying.js
function fi(e, t, n = !0, r = Infinity) {
	return pi(e, Array.isArray(t) ? t : [t], n, r);
}
function pi(e, t, n, r) {
	let i = [], a = [Array.isArray(t) ? t : [t]], o = [0];
	for (;;) {
		if (o[0] >= a[0].length) {
			if (o.length === 1) return i;
			a.shift(), o.shift();
			continue;
		}
		let t = a[0][o[0]++];
		if (e(t) && (i.push(t), --r <= 0)) return i;
		n && yr(t) && t.children.length > 0 && (o.unshift(0), a.unshift(t.children));
	}
}
function mi(e, t) {
	return t.find(e);
}
function hi(e, t, n = !0) {
	let r = Array.isArray(t) ? t : [t];
	for (let t = 0; t < r.length; t++) {
		let i = r[t];
		if (pr(i) && e(i)) return i;
		if (n && yr(i) && i.children.length > 0) {
			let t = hi(e, i.children, !0);
			if (t) return t;
		}
	}
	return null;
}
function gi(e, t) {
	return (Array.isArray(t) ? t : [t]).some((t) => pr(t) && e(t) || yr(t) && gi(e, t.children));
}
function _i(e, t) {
	let n = [], r = [Array.isArray(t) ? t : [t]], i = [0];
	for (;;) {
		if (i[0] >= r[0].length) {
			if (r.length === 1) return n;
			r.shift(), i.shift();
			continue;
		}
		let t = r[0][i[0]++];
		pr(t) && e(t) && n.push(t), yr(t) && t.children.length > 0 && (i.unshift(0), r.unshift(t.children));
	}
}
//#endregion
//#region node_modules/.pnpm/domutils@3.2.2/node_modules/domutils/lib/esm/legacy.js
var vi = {
	tag_name(e) {
		return typeof e == "function" ? (t) => pr(t) && e(t.name) : e === "*" ? pr : (t) => pr(t) && t.name === e;
	},
	tag_type(e) {
		return typeof e == "function" ? (t) => e(t.type) : (t) => t.type === e;
	},
	tag_contains(e) {
		return typeof e == "function" ? (t) => hr(t) && e(t.data) : (t) => hr(t) && t.data === e;
	}
};
function yi(e, t) {
	return typeof t == "function" ? (n) => pr(n) && t(n.attribs[e]) : (n) => pr(n) && n.attribs[e] === t;
}
function bi(e, t) {
	return (n) => e(n) || t(n);
}
function xi(e) {
	let t = Object.keys(e).map((t) => {
		let n = e[t];
		return Object.prototype.hasOwnProperty.call(vi, t) ? vi[t](n) : yi(t, n);
	});
	return t.length === 0 ? null : t.reduce(bi);
}
function Si(e, t) {
	let n = xi(e);
	return n ? n(t) : !0;
}
function Ci(e, t, n, r = Infinity) {
	let i = xi(e);
	return i ? fi(i, t, n, r) : [];
}
function wi(e, t, n = !0) {
	return Array.isArray(t) || (t = [t]), hi(yi("id", e), t, n);
}
function Ti(e, t, n = !0, r = Infinity) {
	return fi(vi.tag_name(e), t, n, r);
}
function Ei(e, t, n = !0, r = Infinity) {
	return fi(yi("class", e), t, n, r);
}
function Di(e, t, n = !0, r = Infinity) {
	return fi(vi.tag_type(e), t, n, r);
}
//#endregion
//#region node_modules/.pnpm/domutils@3.2.2/node_modules/domutils/lib/esm/helpers.js
function Oi(e) {
	let t = e.length;
	for (; --t >= 0;) {
		let n = e[t];
		if (t > 0 && e.lastIndexOf(n, t - 1) >= 0) {
			e.splice(t, 1);
			continue;
		}
		for (let r = n.parent; r; r = r.parent) if (e.includes(r)) {
			e.splice(t, 1);
			break;
		}
	}
	return e;
}
var ki;
(function(e) {
	e[e.DISCONNECTED = 1] = "DISCONNECTED", e[e.PRECEDING = 2] = "PRECEDING", e[e.FOLLOWING = 4] = "FOLLOWING", e[e.CONTAINS = 8] = "CONTAINS", e[e.CONTAINED_BY = 16] = "CONTAINED_BY";
})(ki || (ki = {}));
function Ai(e, t) {
	let n = [], r = [];
	if (e === t) return 0;
	let i = yr(e) ? e : e.parent;
	for (; i;) n.unshift(i), i = i.parent;
	for (i = yr(t) ? t : t.parent; i;) r.unshift(i), i = i.parent;
	let a = Math.min(n.length, r.length), o = 0;
	for (; o < a && n[o] === r[o];) o++;
	if (o === 0) return ki.DISCONNECTED;
	let s = n[o - 1], c = s.children, l = n[o], u = r[o];
	return c.indexOf(l) > c.indexOf(u) ? s === t ? ki.FOLLOWING | ki.CONTAINED_BY : ki.FOLLOWING : s === e ? ki.PRECEDING | ki.CONTAINS : ki.PRECEDING;
}
function ji(e) {
	return e = e.filter((e, t, n) => !n.includes(e, t + 1)), e.sort((e, t) => {
		let n = Ai(e, t);
		return n & ki.PRECEDING ? -1 : n & ki.FOLLOWING ? 1 : 0;
	}), e;
}
//#endregion
//#region node_modules/.pnpm/domutils@3.2.2/node_modules/domutils/lib/esm/feeds.js
function Mi(e) {
	let t = Ri(Vi, e);
	return t ? t.name === "feed" ? Ni(t) : Pi(t) : null;
}
function Ni(e) {
	var t;
	let n = e.children, r = {
		type: "atom",
		items: Ti("entry", n).map((e) => {
			var t;
			let { children: n } = e, r = { media: Li(n) };
			Bi(r, "id", "id", n), Bi(r, "title", "title", n);
			let i = (t = Ri("link", n)) == null ? void 0 : t.attribs.href;
			i && (r.link = i);
			let a = zi("summary", n) || zi("content", n);
			a && (r.description = a);
			let o = zi("updated", n);
			return o && (r.pubDate = new Date(o)), r;
		})
	};
	Bi(r, "id", "id", n), Bi(r, "title", "title", n);
	let i = (t = Ri("link", n)) == null ? void 0 : t.attribs.href;
	i && (r.link = i), Bi(r, "description", "subtitle", n);
	let a = zi("updated", n);
	return a && (r.updated = new Date(a)), Bi(r, "author", "email", n, !0), r;
}
function Pi(e) {
	var t, n;
	let r = (n = (t = Ri("channel", e.children)) == null ? void 0 : t.children) == null ? [] : n, i = {
		type: e.name.substr(0, 3),
		id: "",
		items: Ti("item", e.children).map((e) => {
			let { children: t } = e, n = { media: Li(t) };
			Bi(n, "id", "guid", t), Bi(n, "title", "title", t), Bi(n, "link", "link", t), Bi(n, "description", "description", t);
			let r = zi("pubDate", t) || zi("dc:date", t);
			return r && (n.pubDate = new Date(r)), n;
		})
	};
	Bi(i, "title", "title", r), Bi(i, "link", "link", r), Bi(i, "description", "description", r);
	let a = zi("lastBuildDate", r);
	return a && (i.updated = new Date(a)), Bi(i, "author", "managingEditor", r, !0), i;
}
var Fi = [
	"url",
	"type",
	"lang"
], Ii = [
	"fileSize",
	"bitrate",
	"framerate",
	"samplingrate",
	"channels",
	"duration",
	"height",
	"width"
];
function Li(e) {
	return Ti("media:content", e).map((e) => {
		let { attribs: t } = e, n = {
			medium: t.medium,
			isDefault: !!t.isDefault
		};
		for (let e of Fi) t[e] && (n[e] = t[e]);
		for (let e of Ii) t[e] && (n[e] = parseInt(t[e], 10));
		return t.expression && (n.expression = t.expression), n;
	});
}
function Ri(e, t) {
	return Ti(e, t, !0, 1)[0];
}
function zi(e, t, n = !1) {
	return Xr(Ti(e, t, n, 1)).trim();
}
function Bi(e, t, n, r, i = !1) {
	let a = zi(n, r, i);
	a && (e[t] = a);
}
function Vi(e) {
	return e === "rss" || e === "feed" || e === "rdf:RDF";
}
//#endregion
//#region node_modules/.pnpm/domutils@3.2.2/node_modules/domutils/lib/esm/index.js
var Hi = /* @__PURE__ */ c({
	DocumentPosition: () => ki,
	append: () => li,
	appendChild: () => ci,
	compareDocumentPosition: () => Ai,
	existsOne: () => gi,
	filter: () => fi,
	find: () => pi,
	findAll: () => _i,
	findOne: () => hi,
	findOneChild: () => mi,
	getAttributeValue: () => ti,
	getChildren: () => Qr,
	getElementById: () => wi,
	getElements: () => Ci,
	getElementsByClassName: () => Ei,
	getElementsByTagName: () => Ti,
	getElementsByTagType: () => Di,
	getFeed: () => Mi,
	getInnerHTML: () => Jr,
	getName: () => ri,
	getOuterHTML: () => qr,
	getParent: () => $r,
	getSiblings: () => ei,
	getText: () => Yr,
	hasAttrib: () => ni,
	hasChildren: () => yr,
	innerText: () => Zr,
	isCDATA: () => mr,
	isComment: () => gr,
	isDocument: () => vr,
	isTag: () => pr,
	isText: () => hr,
	nextElementSibling: () => ii,
	prepend: () => di,
	prependChild: () => ui,
	prevElementSibling: () => ai,
	removeElement: () => oi,
	removeSubsets: () => Oi,
	replaceElement: () => si,
	testElement: () => Si,
	textContent: () => Xr,
	uniqueSort: () => ji
}), Ui = /* @__PURE__ */ c({
	DefaultHandler: () => Cr,
	DomHandler: () => Cr,
	DomUtils: () => Hi,
	ElementType: () => qn,
	Parser: () => Kn,
	QuoteType: () => Nn,
	Tokenizer: () => Fn,
	createDocumentStream: () => Ki,
	createDomStream: () => qi,
	getFeed: () => Mi,
	parseDOM: () => Gi,
	parseDocument: () => Wi,
	parseFeed: () => Yi
});
function Wi(e, t) {
	let n = new Cr(void 0, t);
	return new Kn(n, t).end(e), n.root;
}
function Gi(e, t) {
	return Wi(e, t).children;
}
function Ki(e, t, n) {
	let r = new Cr((t) => e(t, r.root), t, n);
	return new Kn(r, t);
}
function qi(e, t, n) {
	return new Kn(new Cr(e, t, n), t);
}
var Ji = { xmlMode: !0 };
function Yi(e, t = Ji) {
	return Mi(Gi(e, t));
}
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/shared/constants.js
var Xi = new Set(/* @__PURE__ */ "ARTICLE.ASIDE.BLOCKQUOTE.BODY.BR.BUTTON.CANVAS.CAPTION.COL.COLGROUP.DD.DIV.DL.DT.EMBED.FIELDSET.FIGCAPTION.FIGURE.FOOTER.FORM.H1.H2.H3.H4.H5.H6.LI.UL.OL.P".split(".")), Zi = "http://www.w3.org/2000/svg", { assign: Qi, create: $i, defineProperties: ea, entries: ta, getOwnPropertyDescriptors: na, keys: ra, setPrototypeOf: ia } = Object, aa = String, oa = (e) => e.nodeType === 1 ? e[W] : e, sa = ({ ownerDocument: e }) => e[tn].ignoreCase, ca = (e, t) => {
	e[G] = t, t[an] = e;
}, la = (e, t, n) => {
	ca(e, t), ca(oa(t), n);
}, ua = (e, t, n, r) => {
	ca(e, t), ca(oa(n), r);
}, da = (e, t, n) => {
	ca(e, t), ca(t, n);
}, fa = ({ localName: e, ownerDocument: t }) => t[tn].ignoreCase ? e.toUpperCase() : e, pa = (e, t) => {
	e && (e[G] = t), t && (t[an] = e);
}, ma = (e, t) => {
	let n = e.createDocumentFragment(), r = e.createElement("");
	r.innerHTML = t;
	let { firstChild: i, lastChild: a } = r;
	if (i) {
		ua(n, i, a, n[W]);
		let e = i;
		do
			e.parentNode = n;
		while (e !== a && (e = oa(e)[G]));
	}
	return n;
}, ha = /* @__PURE__ */ new WeakMap(), ga = !1, _a = /* @__PURE__ */ new WeakMap(), va = /* @__PURE__ */ new WeakMap(), ya = (e, t, n, r) => {
	ga && va.has(e) && e.attributeChangedCallback && e.constructor.observedAttributes.includes(t) && e.attributeChangedCallback(t, n, r);
}, ba = (e, t) => (n) => {
	if (va.has(n)) {
		let r = va.get(n);
		r.connected !== t && n.isConnected === t && (r.connected = t, e in n && n[e]());
	}
}, xa = ba("connectedCallback", !0), Sa = (e) => {
	if (ga) {
		xa(e), ha.has(e) && (e = ha.get(e).shadowRoot);
		let { [G]: t, [W]: n } = e;
		for (; t !== n;) t.nodeType === 1 && xa(t), t = t[G];
	}
}, Ca = ba("disconnectedCallback", !1), wa = (e) => {
	if (ga) {
		Ca(e), ha.has(e) && (e = ha.get(e).shadowRoot);
		let { [G]: t, [W]: n } = e;
		for (; t !== n;) t.nodeType === 1 && Ca(t), t = t[G];
	}
}, Ta = class {
	constructor(e) {
		this.ownerDocument = e, this.registry = /* @__PURE__ */ new Map(), this.waiting = /* @__PURE__ */ new Map(), this.active = !1;
	}
	define(e, t, n = {}) {
		let { ownerDocument: r, registry: i, waiting: a } = this;
		if (i.has(e)) throw Error("unable to redefine " + e);
		if (_a.has(t)) throw Error("unable to redefine the same class: " + t);
		this.active = ga = !0;
		let { extends: o } = n;
		_a.set(t, {
			ownerDocument: r,
			options: { is: o ? e : "" },
			localName: o || e
		});
		let s = o ? (t) => t.localName === o && t.getAttribute("is") === e : (t) => t.localName === e;
		if (i.set(e, {
			Class: t,
			check: s
		}), a.has(e)) {
			for (let n of a.get(e)) n(t);
			a.delete(e);
		}
		r.querySelectorAll(o ? `${o}[is="${e}"]` : e).forEach(this.upgrade, this);
	}
	upgrade(e) {
		if (va.has(e)) return;
		let { ownerDocument: t, registry: n } = this, r = e.getAttribute("is") || e.localName;
		if (n.has(r)) {
			let { Class: i, check: a } = n.get(r);
			if (a(e)) {
				let { attributes: n, isConnected: a } = e;
				for (let t of n) e.removeAttributeNode(t);
				let o = ta(e);
				for (let [t] of o) delete e[t];
				ia(e, i.prototype), t[un] = {
					element: e,
					values: o
				}, new i(t, r), va.set(e, { connected: a });
				for (let t of n) e.setAttributeNode(t);
				a && e.connectedCallback && e.connectedCallback();
			}
		}
	}
	whenDefined(e) {
		let { registry: t, waiting: n } = this;
		return new Promise((r) => {
			t.has(e) ? r(t.get(e).Class) : (n.has(e) || n.set(e, []), n.get(e).push(r));
		});
	}
	get(e) {
		let t = this.registry.get(e);
		return t && t.Class;
	}
	getName(e) {
		if (_a.has(e)) {
			let { localName: t } = _a.get(e);
			return t;
		}
		return null;
	}
}, { Parser: Ea } = Ui, Da = (e, t, n) => {
	let r = e[W];
	return t.parentNode = e, la(r[an], t, r), n && t.nodeType === 1 && Sa(t), t;
}, Oa = (e, t, n, r, i) => {
	n[dn] = r, n.ownerElement = e, da(t[an], n, t), n.name === "class" && (e.className = r), i && ya(e, n.name, null, r);
}, ka = (e, t, n) => {
	let { active: r, registry: i } = e[qt], a = e, o = null, s = !1, c = new Ea({
		onprocessinginstruction(t, n) {
			t.toLowerCase() === "!doctype" && (e.doctype = n.slice(t.length).trim());
		},
		onopentag(n, s) {
			let c = !0;
			if (t) {
				if (o) a = Da(a, e.createElementNS(Zi, n), r), a.ownerSVGElement = o, c = !1;
				else if (n === "svg" || n === "SVG") o = e.createElementNS(Zi, n), a = Da(a, o, r), c = !1;
				else if (r) {
					let e = n.includes("-") ? n : s.is || "";
					if (e && i.has(e)) {
						let { Class: t } = i.get(e);
						a = Da(a, new t(), r), delete s.is, c = !1;
					}
				}
			}
			c && (a = Da(a, e.createElement(n), !1));
			let l = a[W];
			for (let t of ra(s)) Oa(a, l, e.createAttribute(t), s[t], r);
		},
		oncomment(t) {
			Da(a, e.createComment(t), r);
		},
		ontext(t) {
			s ? Da(a, e.createCDATASection(t), r) : Da(a, e.createTextNode(t), r);
		},
		oncdatastart() {
			s = !0;
		},
		oncdataend() {
			s = !1;
		},
		onclosetag() {
			t && a === o && (o = null), a = a.parentNode;
		}
	}, {
		lowerCaseAttributeNames: !1,
		decodeEntities: !0,
		xmlMode: !t
	});
	return c.write(n), c.end(), e;
}, Aa = /* @__PURE__ */ new Map(), ja = (e, t) => {
	for (let n of [].concat(e)) Aa.set(n, t), Aa.set(n.toUpperCase(), t);
}, Ma = ({ [G]: e, [W]: t }, n) => {
	for (; e !== t;) {
		switch (e.nodeType) {
			case 2:
				Na(e, n);
				break;
			case 3:
			case 8:
			case 4:
				Pa(e, n);
				break;
			case 1:
				La(e, n), e = oa(e);
				break;
			case 10:
				Ia(e, n);
				break;
		}
		e = e[G];
	}
	let r = n.length - 1, i = n[r];
	typeof i == "number" && i < 0 ? n[r] += -1 : n.push(-1);
}, Na = (e, t) => {
	t.push(2, e.name);
	let n = e[dn].trim();
	n && t.push(n);
}, Pa = (e, t) => {
	let n = e[dn];
	n.trim() && t.push(e.nodeType, n);
}, Fa = (e, t) => {
	t.push(e.nodeType), Ma(e, t);
}, Ia = ({ name: e, publicId: t, systemId: n }, r) => {
	r.push(10, e), t && r.push(t), n && r.push(n);
}, La = (e, t) => {
	t.push(1, e.localName), Ma(e, t);
}, Ra = (e, t, n, r, i, a, o) => ({
	type: e,
	target: t,
	addedNodes: r,
	removedNodes: i,
	attributeName: a,
	oldValue: o,
	previousSibling: (n == null ? void 0 : n.previousSibling) || null,
	nextSibling: (n == null ? void 0 : n.nextSibling) || null
}), za = (e, t, n, r, i, a) => {
	if (!r || r.includes(n)) {
		let { callback: r, records: o, scheduled: s } = e;
		o.push(Ra("attributes", t, null, [], [], n, i ? a : void 0)), s || (e.scheduled = !0, Promise.resolve().then(() => {
			e.scheduled = !1, r(o.splice(0), e);
		}));
	}
}, Ba = (e, t, n) => {
	let { ownerDocument: r } = e, { active: i, observers: a } = r[nn];
	if (i) {
		for (let i of a) for (let [a, { childList: o, subtree: s, attributes: c, attributeFilter: l, attributeOldValue: u }] of i.nodes) if (o) {
			if (s && (a === r || a.contains(e)) || !s && a.children.includes(e)) {
				za(i, e, t, l, u, n);
				break;
			}
		} else if (c && a === e) {
			za(i, e, t, l, u, n);
			break;
		}
	}
}, Va = (e, t) => {
	let { ownerDocument: n } = e, { active: r, observers: i } = n[nn];
	if (r) {
		for (let r of i) for (let [i, { subtree: a, childList: o, characterData: s }] of r.nodes) if (o && (t && (i === t || a && i.contains(t)) || !t && (a && (i === n || i.contains(e)) || !a && i[s ? "childNodes" : "children"].includes(e)))) {
			let { callback: n, records: a, scheduled: o } = r;
			a.push(Ra("childList", i, e, t ? [] : [e], t ? [e] : [])), o || (r.scheduled = !0, Promise.resolve().then(() => {
				r.scheduled = !1, n(a.splice(0), r);
			}));
			break;
		}
	}
}, Ha = class {
	constructor(e) {
		let t = /* @__PURE__ */ new Set();
		this.observers = t, this.active = !1, this.class = class {
			constructor(e) {
				this.callback = e, this.nodes = /* @__PURE__ */ new Map(), this.records = [], this.scheduled = !1;
			}
			disconnect() {
				this.records.splice(0), this.nodes.clear(), t.delete(this), e[nn].active = !!t.size;
			}
			observe(n, r = {
				subtree: !1,
				childList: !1,
				attributes: !1,
				attributeFilter: null,
				attributeOldValue: !1,
				characterData: !1
			}) {
				("attributeOldValue" in r || "attributeFilter" in r) && (r.attributes = !0), r.childList = !!r.childList, r.subtree = !!r.subtree, this.nodes.set(n, r), t.add(this), e[nn].active = !0;
			}
			takeRecords() {
				return this.records.splice(0);
			}
		};
	}
}, Ua = new Set(/* @__PURE__ */ "allowfullscreen.allowpaymentrequest.async.autofocus.autoplay.checked.class.contenteditable.controls.default.defer.disabled.draggable.formnovalidate.hidden.id.ismap.itemscope.loop.multiple.muted.nomodule.novalidate.open.playsinline.readonly.required.reversed.selected.style.truespeed".split(".")), Wa = (e, t) => {
	let { [dn]: n, name: r } = t;
	t.ownerElement = e, da(e, t, e[G]), r === "class" && (e.className = n), Ba(e, r, null), ya(e, r, null, n);
}, Ga = (e, t) => {
	let { [dn]: n, name: r } = t;
	ca(t[an], t[G]), t.ownerElement = t[an] = t[G] = null, r === "class" && (e[Kt] = null), Ba(e, r, n), ya(e, r, n, null);
}, Ka = {
	get(e, t) {
		return e.hasAttribute(t);
	},
	set(e, t, n) {
		n ? e.setAttribute(t, "") : e.removeAttribute(t);
	}
}, qa = {
	get(e, t) {
		return parseFloat(e.getAttribute(t) || 0);
	},
	set(e, t, n) {
		e.setAttribute(t, n);
	}
}, Y = {
	get(e, t) {
		return e.getAttribute(t) || "";
	},
	set(e, t, n) {
		e.setAttribute(t, n);
	}
}, Ja = /* @__PURE__ */ new WeakMap();
function Ya(e, t) {
	return typeof t == "function" ? t.call(e.target, e) : t.handleEvent(e), e._stopImmediatePropagationFlag;
}
function Xa({ currentTarget: e, target: t }) {
	let n = Ja.get(e);
	if (n && n.has(this.type)) {
		let r = n.get(this.type);
		e === t ? this.eventPhase = this.AT_TARGET : this.eventPhase = this.BUBBLING_PHASE, this.currentTarget = e, this.target = t;
		for (let [e, t] of r) if (t && t.once && r.delete(e), Ya(this, e)) break;
		return delete this.currentTarget, delete this.target, this.cancelBubble;
	}
}
var Za = class {
	constructor() {
		Ja.set(this, /* @__PURE__ */ new Map());
	}
	_getParent() {
		return null;
	}
	addEventListener(e, t, n) {
		let r = Ja.get(this);
		r.has(e) || r.set(e, /* @__PURE__ */ new Map()), r.get(e).set(t, n);
	}
	removeEventListener(e, t) {
		let n = Ja.get(this);
		if (n.has(e)) {
			let r = n.get(e);
			r.delete(t) && !r.size && n.delete(e);
		}
	}
	dispatchEvent(e) {
		let t = this;
		for (e.eventPhase = e.CAPTURING_PHASE; t;) t.dispatchEvent && e._path.push({
			currentTarget: t,
			target: this
		}), t = e.bubbles && t._getParent && t._getParent();
		return e._path.some(Xa, e), e._path = [], e.eventPhase = e.NONE, !e.defaultPrevented;
	}
}, Qa = class extends Array {
	item(e) {
		return e < this.length ? this[e] : null;
	}
}, $a = ({ parentNode: e }) => {
	let t = 0;
	for (; e;) t++, e = e.parentNode;
	return t;
}, eo = class extends Za {
	static get ELEMENT_NODE() {
		return 1;
	}
	static get ATTRIBUTE_NODE() {
		return 2;
	}
	static get TEXT_NODE() {
		return 3;
	}
	static get CDATA_SECTION_NODE() {
		return 4;
	}
	static get COMMENT_NODE() {
		return 8;
	}
	static get DOCUMENT_NODE() {
		return 9;
	}
	static get DOCUMENT_FRAGMENT_NODE() {
		return 11;
	}
	static get DOCUMENT_TYPE_NODE() {
		return 10;
	}
	constructor(e, t, n) {
		super(), this.ownerDocument = e, this.localName = t, this.nodeType = n, this.parentNode = null, this[G] = null, this[an] = null;
	}
	get ELEMENT_NODE() {
		return 1;
	}
	get ATTRIBUTE_NODE() {
		return 2;
	}
	get TEXT_NODE() {
		return 3;
	}
	get CDATA_SECTION_NODE() {
		return 4;
	}
	get COMMENT_NODE() {
		return 8;
	}
	get DOCUMENT_NODE() {
		return 9;
	}
	get DOCUMENT_FRAGMENT_NODE() {
		return 11;
	}
	get DOCUMENT_TYPE_NODE() {
		return 10;
	}
	get baseURI() {
		let e = this.nodeType === 9 ? this : this.ownerDocument;
		if (e) {
			let t = e.querySelector("base");
			if (t) return t.getAttribute("href");
			let { location: n } = e.defaultView;
			if (n) return n.href;
		}
		return null;
	}
	/* c8 ignore start */
	get isConnected() {
		return !1;
	}
	get nodeName() {
		return this.localName;
	}
	get parentElement() {
		return null;
	}
	get previousSibling() {
		return null;
	}
	get previousElementSibling() {
		return null;
	}
	get nextSibling() {
		return null;
	}
	get nextElementSibling() {
		return null;
	}
	get childNodes() {
		return new Qa();
	}
	get firstChild() {
		return null;
	}
	get lastChild() {
		return null;
	}
	get nodeValue() {
		return null;
	}
	set nodeValue(e) {}
	get textContent() {
		return null;
	}
	set textContent(e) {}
	normalize() {}
	cloneNode() {
		return null;
	}
	contains() {
		return !1;
	}
	insertBefore(e, t) {
		return e;
	}
	appendChild(e) {
		return e;
	}
	replaceChild(e, t) {
		return t;
	}
	removeChild(e) {
		return e;
	}
	toString() {
		return "";
	}
	/* c8 ignore stop */
	hasChildNodes() {
		return !!this.lastChild;
	}
	isSameNode(e) {
		return this === e;
	}
	compareDocumentPosition(e) {
		let t = 0;
		if (this !== e) {
			let n = $a(this), r = $a(e);
			if (n < r) t += 4, this.contains(e) && (t += 16);
			else if (r < n) t += 2, e.contains(this) && (t += 8);
			else if (n && r) {
				let { childNodes: n } = this.parentNode;
				n.indexOf(this) < n.indexOf(e) ? t += 4 : t += 2;
			}
			(!n || !r) && (t += 32, t += 1);
		}
		return t;
	}
	isEqualNode(e) {
		if (this === e) return !0;
		if (this.nodeType === e.nodeType) {
			switch (this.nodeType) {
				case 9:
				case 11: {
					let t = this.childNodes, n = e.childNodes;
					return t.length === n.length && t.every((e, t) => e.isEqualNode(n[t]));
				}
			}
			return this.toString() === e.toString();
		}
		return !1;
	}
	_getParent() {
		return this.parentNode;
	}
	getRootNode() {
		let e = this;
		for (; e.parentNode;) e = e.parentNode;
		return e;
	}
}, { replace: to } = "", no = /[<>&\xA0]/g, ro = {
	"\xA0": "&#160;",
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;"
}, io = (e) => ro[e], ao = (e) => to.call(e, no, io), oo = /"/g, so = class e extends eo {
	constructor(e, t, n = "") {
		super(e, t, 2), this.ownerElement = null, this.name = aa(t), this[dn] = aa(n), this[Gt] = !1;
	}
	get value() {
		return this[dn];
	}
	set value(e) {
		let { [dn]: t, name: n, ownerElement: r } = this;
		this[dn] = aa(e), this[Gt] = !0, r && (Ba(r, n, t), ya(r, n, t, this[dn]));
	}
	cloneNode() {
		let { ownerDocument: t, name: n, [dn]: r } = this;
		return new e(t, n, r);
	}
	toString() {
		let { name: e, [dn]: t } = this;
		return Ua.has(e) && !t ? sa(this) ? e : `${e}=""` : `${e}="${(sa(this) ? t : ao(t)).replace(oo, "&quot;")}"`;
	}
	toJSON() {
		let e = [];
		return Na(this, e), e;
	}
}, co = ({ ownerDocument: e, parentNode: t }) => {
	for (; t;) {
		if (t === e) return !0;
		t = t.parentNode || t.host;
	}
	return !1;
}, lo = ({ parentNode: e }) => {
	if (e) switch (e.nodeType) {
		case 9:
		case 11: return null;
	}
	return e;
}, uo = ({ [an]: e }) => {
	switch (e ? e.nodeType : 0) {
		case -1: return e[cn];
		case 3:
		case 8:
		case 4: return e;
	}
	return null;
}, fo = (e) => {
	let t = oa(e)[G];
	return t && (t.nodeType === -1 ? null : t);
}, po = (e) => {
	let t = fo(e);
	for (; t && t.nodeType !== 1;) t = fo(t);
	return t;
}, mo = (e) => {
	let t = uo(e);
	for (; t && t.nodeType !== 1;) t = uo(t);
	return t;
}, ho = (e, t) => {
	let n = e.createDocumentFragment();
	return n.append(...t), n;
}, go = (e, t) => {
	let { ownerDocument: n, parentNode: r } = e;
	r && r.insertBefore(ho(n, t), e);
}, _o = (e, t) => {
	let { ownerDocument: n, parentNode: r } = e;
	r && r.insertBefore(ho(n, t), oa(e)[G]);
}, vo = (e, t) => {
	let { ownerDocument: n, parentNode: r } = e;
	r && (t.includes(e) && vo(e, [e = e.cloneNode()]), r.insertBefore(ho(n, t), e), e.remove());
}, yo = (e, t, n) => {
	let { parentNode: r, nodeType: i } = t;
	(e || n) && (pa(e, n), t[an] = null, oa(t)[G] = null), r && (t.parentNode = null, Va(t, r), i === 1 && wa(t));
}, bo = class extends eo {
	constructor(e, t, n, r) {
		super(e, t, n), this[dn] = aa(r);
	}
	get isConnected() {
		return co(this);
	}
	get parentElement() {
		return lo(this);
	}
	get previousSibling() {
		return uo(this);
	}
	get nextSibling() {
		return fo(this);
	}
	get previousElementSibling() {
		return mo(this);
	}
	get nextElementSibling() {
		return po(this);
	}
	before(...e) {
		go(this, e);
	}
	after(...e) {
		_o(this, e);
	}
	replaceWith(...e) {
		vo(this, e);
	}
	remove() {
		yo(this[an], this, this[G]);
	}
	/* c8 ignore start */
	get data() {
		return this[dn];
	}
	set data(e) {
		this[dn] = aa(e), Va(this, this.parentNode);
	}
	get nodeValue() {
		return this.data;
	}
	set nodeValue(e) {
		this.data = e;
	}
	get textContent() {
		return this.data;
	}
	set textContent(e) {
		this.data = e;
	}
	get length() {
		return this.data.length;
	}
	substringData(e, t) {
		return this.data.substr(e, t);
	}
	appendData(e) {
		this.data += e;
	}
	insertData(e, t) {
		let { data: n } = this;
		this.data = n.slice(0, e) + t + n.slice(e);
	}
	deleteData(e, t) {
		let { data: n } = this;
		this.data = n.slice(0, e) + n.slice(e + t);
	}
	replaceData(e, t, n) {
		let { data: r } = this;
		this.data = r.slice(0, e) + n + r.slice(e + t);
	}
	/* c8 ignore stop */
	toJSON() {
		let e = [];
		return Pa(this, e), e;
	}
}, xo = class e extends bo {
	constructor(e, t = "") {
		super(e, "#cdatasection", 4, t);
	}
	cloneNode() {
		let { ownerDocument: t, [dn]: n } = this;
		return new e(t, n);
	}
	toString() {
		return `<![CDATA[${this[dn]}]]>`;
	}
}, So = class e extends bo {
	constructor(e, t = "") {
		super(e, "#comment", 8, t);
	}
	cloneNode() {
		let { ownerDocument: t, [dn]: n } = this;
		return new e(t, n);
	}
	toString() {
		return `<!--${this[dn]}-->`;
	}
};
//#endregion
//#region node_modules/.pnpm/domhandler@5.0.2/node_modules/domhandler/lib/esm/node.js
function Co(e) {
	return Jn(e);
}
function wo(e) {
	return e.type === J.CDATA;
}
function To(e) {
	return e.type === J.Text;
}
function Eo(e) {
	return e.type === J.Comment;
}
function Do(e) {
	return e.type === J.Root;
}
function Oo(e) {
	return Object.prototype.hasOwnProperty.call(e, "children");
}
//#endregion
//#region node_modules/.pnpm/domutils@3.0.1/node_modules/domutils/lib/esm/stringify.js
function ko(e, t) {
	return Rr(e, t);
}
function Ao(e, t) {
	return Oo(e) ? e.children.map((e) => ko(e, t)).join("") : "";
}
function jo(e) {
	return Array.isArray(e) ? e.map(jo).join("") : Co(e) ? e.name === "br" ? "\n" : jo(e.children) : wo(e) ? jo(e.children) : To(e) ? e.data : "";
}
function Mo(e) {
	return Array.isArray(e) ? e.map(Mo).join("") : Oo(e) && !Eo(e) ? Mo(e.children) : To(e) ? e.data : "";
}
function No(e) {
	return Array.isArray(e) ? e.map(No).join("") : Oo(e) && (e.type === J.Tag || wo(e)) ? No(e.children) : To(e) ? e.data : "";
}
//#endregion
//#region node_modules/.pnpm/domutils@3.0.1/node_modules/domutils/lib/esm/traversal.js
function Po(e) {
	return Oo(e) ? e.children : [];
}
function Fo(e) {
	return e.parent || null;
}
function Io(e) {
	let t = Fo(e);
	if (t != null) return Po(t);
	let n = [e], { prev: r, next: i } = e;
	for (; r != null;) n.unshift(r), {prev: r} = r;
	for (; i != null;) n.push(i), {next: i} = i;
	return n;
}
function Lo(e, t) {
	var n;
	return (n = e.attribs) == null ? void 0 : n[t];
}
function Ro(e, t) {
	return e.attribs != null && Object.prototype.hasOwnProperty.call(e.attribs, t) && e.attribs[t] != null;
}
function zo(e) {
	return e.name;
}
function Bo(e) {
	let { next: t } = e;
	for (; t !== null && !Co(t);) ({next: t} = t);
	return t;
}
function Vo(e) {
	let { prev: t } = e;
	for (; t !== null && !Co(t);) ({prev: t} = t);
	return t;
}
//#endregion
//#region node_modules/.pnpm/domutils@3.0.1/node_modules/domutils/lib/esm/manipulation.js
function Ho(e) {
	if (e.prev && (e.prev.next = e.next), e.next && (e.next.prev = e.prev), e.parent) {
		let t = e.parent.children;
		t.splice(t.lastIndexOf(e), 1);
	}
}
function Uo(e, t) {
	let n = t.prev = e.prev;
	n && (n.next = t);
	let r = t.next = e.next;
	r && (r.prev = t);
	let i = t.parent = e.parent;
	if (i) {
		let n = i.children;
		n[n.lastIndexOf(e)] = t, e.parent = null;
	}
}
function Wo(e, t) {
	if (Ho(t), t.next = null, t.parent = e, e.children.push(t) > 1) {
		let n = e.children[e.children.length - 2];
		n.next = t, t.prev = n;
	} else t.prev = null;
}
function Go(e, t) {
	Ho(t);
	let { parent: n } = e, r = e.next;
	if (t.next = r, t.prev = e, e.next = t, t.parent = n, r) {
		if (r.prev = t, n) {
			let e = n.children;
			e.splice(e.lastIndexOf(r), 0, t);
		}
	} else n && n.children.push(t);
}
function Ko(e, t) {
	if (Ho(t), t.parent = e, t.prev = null, e.children.unshift(t) !== 1) {
		let n = e.children[1];
		n.prev = t, t.next = n;
	} else t.next = null;
}
function qo(e, t) {
	Ho(t);
	let { parent: n } = e;
	if (n) {
		let r = n.children;
		r.splice(r.indexOf(e), 0, t);
	}
	e.prev && (e.prev.next = t), t.parent = n, t.prev = e.prev, t.next = e, e.prev = t;
}
//#endregion
//#region node_modules/.pnpm/domutils@3.0.1/node_modules/domutils/lib/esm/querying.js
function Jo(e, t, n = !0, r = Infinity) {
	return Array.isArray(t) || (t = [t]), Yo(e, t, n, r);
}
function Yo(e, t, n, r) {
	let i = [];
	for (let a of t) {
		if (e(a) && (i.push(a), --r <= 0)) break;
		if (n && Oo(a) && a.children.length > 0) {
			let t = Yo(e, a.children, n, r);
			if (i.push(...t), r -= t.length, r <= 0) break;
		}
	}
	return i;
}
function Xo(e, t) {
	return t.find(e);
}
function Zo(e, t, n = !0) {
	let r = null;
	for (let i = 0; i < t.length && !r; i++) {
		let a = t[i];
		if (Co(a)) e(a) ? r = a : n && a.children.length > 0 && (r = Zo(e, a.children, !0));
		else continue;
	}
	return r;
}
function Qo(e, t) {
	return t.some((t) => Co(t) && (e(t) || t.children.length > 0 && Qo(e, t.children)));
}
function $o(e, t) {
	var n;
	let r = [], i = t.filter(Co), a;
	for (; a = i.shift();) {
		let t = (n = a.children) == null ? void 0 : n.filter(Co);
		t && t.length > 0 && i.unshift(...t), e(a) && r.push(a);
	}
	return r;
}
//#endregion
//#region node_modules/.pnpm/domutils@3.0.1/node_modules/domutils/lib/esm/legacy.js
var es = {
	tag_name(e) {
		return typeof e == "function" ? (t) => Co(t) && e(t.name) : e === "*" ? Co : (t) => Co(t) && t.name === e;
	},
	tag_type(e) {
		return typeof e == "function" ? (t) => e(t.type) : (t) => t.type === e;
	},
	tag_contains(e) {
		return typeof e == "function" ? (t) => To(t) && e(t.data) : (t) => To(t) && t.data === e;
	}
};
function ts(e, t) {
	return typeof t == "function" ? (n) => Co(n) && t(n.attribs[e]) : (n) => Co(n) && n.attribs[e] === t;
}
function ns(e, t) {
	return (n) => e(n) || t(n);
}
function rs(e) {
	let t = Object.keys(e).map((t) => {
		let n = e[t];
		return Object.prototype.hasOwnProperty.call(es, t) ? es[t](n) : ts(t, n);
	});
	return t.length === 0 ? null : t.reduce(ns);
}
function is(e, t) {
	let n = rs(e);
	return n ? n(t) : !0;
}
function as(e, t, n, r = Infinity) {
	let i = rs(e);
	return i ? Jo(i, t, n, r) : [];
}
function os(e, t, n = !0) {
	return Array.isArray(t) || (t = [t]), Zo(ts("id", e), t, n);
}
function ss(e, t, n = !0, r = Infinity) {
	return Jo(es.tag_name(e), t, n, r);
}
function cs(e, t, n = !0, r = Infinity) {
	return Jo(es.tag_type(e), t, n, r);
}
//#endregion
//#region node_modules/.pnpm/domutils@3.0.1/node_modules/domutils/lib/esm/helpers.js
function ls(e) {
	let t = e.length;
	for (; --t >= 0;) {
		let n = e[t];
		if (t > 0 && e.lastIndexOf(n, t - 1) >= 0) {
			e.splice(t, 1);
			continue;
		}
		for (let r = n.parent; r; r = r.parent) if (e.includes(r)) {
			e.splice(t, 1);
			break;
		}
	}
	return e;
}
var us;
(function(e) {
	e[e.DISCONNECTED = 1] = "DISCONNECTED", e[e.PRECEDING = 2] = "PRECEDING", e[e.FOLLOWING = 4] = "FOLLOWING", e[e.CONTAINS = 8] = "CONTAINS", e[e.CONTAINED_BY = 16] = "CONTAINED_BY";
})(us || (us = {}));
function ds(e, t) {
	let n = [], r = [];
	if (e === t) return 0;
	let i = Oo(e) ? e : e.parent;
	for (; i;) n.unshift(i), i = i.parent;
	for (i = Oo(t) ? t : t.parent; i;) r.unshift(i), i = i.parent;
	let a = Math.min(n.length, r.length), o = 0;
	for (; o < a && n[o] === r[o];) o++;
	if (o === 0) return us.DISCONNECTED;
	let s = n[o - 1], c = s.children, l = n[o], u = r[o];
	return c.indexOf(l) > c.indexOf(u) ? s === t ? us.FOLLOWING | us.CONTAINED_BY : us.FOLLOWING : s === e ? us.PRECEDING | us.CONTAINS : us.PRECEDING;
}
function fs(e) {
	return e = e.filter((e, t, n) => !n.includes(e, t + 1)), e.sort((e, t) => {
		let n = ds(e, t);
		return n & us.PRECEDING ? -1 : n & us.FOLLOWING ? 1 : 0;
	}), e;
}
//#endregion
//#region node_modules/.pnpm/domutils@3.0.1/node_modules/domutils/lib/esm/feeds.js
function ps(e) {
	let t = ys(Ss, e);
	return t ? t.name === "feed" ? ms(t) : hs(t) : null;
}
function ms(e) {
	var t;
	let n = e.children, r = {
		type: "atom",
		items: ss("entry", n).map((e) => {
			var t;
			let { children: n } = e, r = { media: vs(n) };
			xs(r, "id", "id", n), xs(r, "title", "title", n);
			let i = (t = ys("link", n)) == null ? void 0 : t.attribs.href;
			i && (r.link = i);
			let a = bs("summary", n) || bs("content", n);
			a && (r.description = a);
			let o = bs("updated", n);
			return o && (r.pubDate = new Date(o)), r;
		})
	};
	xs(r, "id", "id", n), xs(r, "title", "title", n);
	let i = (t = ys("link", n)) == null ? void 0 : t.attribs.href;
	i && (r.link = i), xs(r, "description", "subtitle", n);
	let a = bs("updated", n);
	return a && (r.updated = new Date(a)), xs(r, "author", "email", n, !0), r;
}
function hs(e) {
	var t, n;
	let r = (n = (t = ys("channel", e.children)) == null ? void 0 : t.children) == null ? [] : n, i = {
		type: e.name.substr(0, 3),
		id: "",
		items: ss("item", e.children).map((e) => {
			let { children: t } = e, n = { media: vs(t) };
			xs(n, "id", "guid", t), xs(n, "title", "title", t), xs(n, "link", "link", t), xs(n, "description", "description", t);
			let r = bs("pubDate", t);
			return r && (n.pubDate = new Date(r)), n;
		})
	};
	xs(i, "title", "title", r), xs(i, "link", "link", r), xs(i, "description", "description", r);
	let a = bs("lastBuildDate", r);
	return a && (i.updated = new Date(a)), xs(i, "author", "managingEditor", r, !0), i;
}
var gs = [
	"url",
	"type",
	"lang"
], _s = [
	"fileSize",
	"bitrate",
	"framerate",
	"samplingrate",
	"channels",
	"duration",
	"height",
	"width"
];
function vs(e) {
	return ss("media:content", e).map((e) => {
		let { attribs: t } = e, n = {
			medium: t.medium,
			isDefault: !!t.isDefault
		};
		for (let e of gs) t[e] && (n[e] = t[e]);
		for (let e of _s) t[e] && (n[e] = parseInt(t[e], 10));
		return t.expression && (n.expression = t.expression), n;
	});
}
function ys(e, t) {
	return ss(e, t, !0, 1)[0];
}
function bs(e, t, n = !1) {
	return Mo(ss(e, t, n, 1)).trim();
}
function xs(e, t, n, r, i = !1) {
	let a = bs(n, r, i);
	a && (e[t] = a);
}
function Ss(e) {
	return e === "rss" || e === "feed" || e === "rdf:RDF";
}
//#endregion
//#region node_modules/.pnpm/domutils@3.0.1/node_modules/domutils/lib/esm/index.js
var Cs = /* @__PURE__ */ c({
	DocumentPosition: () => us,
	append: () => Go,
	appendChild: () => Wo,
	compareDocumentPosition: () => ds,
	existsOne: () => Qo,
	filter: () => Jo,
	find: () => Yo,
	findAll: () => $o,
	findOne: () => Zo,
	findOneChild: () => Xo,
	getAttributeValue: () => Lo,
	getChildren: () => Po,
	getElementById: () => os,
	getElements: () => as,
	getElementsByTagName: () => ss,
	getElementsByTagType: () => cs,
	getFeed: () => ps,
	getInnerHTML: () => Ao,
	getName: () => zo,
	getOuterHTML: () => ko,
	getParent: () => Fo,
	getSiblings: () => Io,
	getText: () => jo,
	hasAttrib: () => Ro,
	hasChildren: () => Oo,
	innerText: () => No,
	isCDATA: () => wo,
	isComment: () => Eo,
	isDocument: () => Do,
	isTag: () => Co,
	isText: () => To,
	nextElementSibling: () => Bo,
	prepend: () => qo,
	prependChild: () => Ko,
	prevElementSibling: () => Vo,
	removeElement: () => Ho,
	removeSubsets: () => ls,
	replaceElement: () => Uo,
	testElement: () => is,
	textContent: () => Mo,
	uniqueSort: () => fs
}), ws = /* @__PURE__ */ s(((e, t) => {
	t.exports = {
		trueFunc: function() {
			return !0;
		},
		falseFunc: function() {
			return !1;
		}
	};
})), X;
(function(e) {
	e.Attribute = "attribute", e.Pseudo = "pseudo", e.PseudoElement = "pseudo-element", e.Tag = "tag", e.Universal = "universal", e.Adjacent = "adjacent", e.Child = "child", e.Descendant = "descendant", e.Parent = "parent", e.Sibling = "sibling", e.ColumnCombinator = "column-combinator";
})(X || (X = {}));
var Ts;
(function(e) {
	e.Any = "any", e.Element = "element", e.End = "end", e.Equals = "equals", e.Exists = "exists", e.Hyphen = "hyphen", e.Not = "not", e.Start = "start";
})(Ts || (Ts = {}));
//#endregion
//#region node_modules/.pnpm/css-what@6.1.0/node_modules/css-what/lib/es/parse.js
var Es = /^[^\\#]?(?:\\(?:[\da-f]{1,6}\s?|.)|[\w\-\u00b0-\uFFFF])+/, Ds = /\\([\da-f]{1,6}\s?|(\s)|.)/gi, Os = new Map([
	[126, Ts.Element],
	[94, Ts.Start],
	[36, Ts.End],
	[42, Ts.Any],
	[33, Ts.Not],
	[124, Ts.Hyphen]
]), ks = new Set([
	"has",
	"not",
	"matches",
	"is",
	"where",
	"host",
	"host-context"
]);
function As(e) {
	switch (e.type) {
		case X.Adjacent:
		case X.Child:
		case X.Descendant:
		case X.Parent:
		case X.Sibling:
		case X.ColumnCombinator: return !0;
		default: return !1;
	}
}
var js = new Set(["contains", "icontains"]);
function Ms(e, t, n) {
	let r = parseInt(t, 16) - 65536;
	return r !== r || n ? t : r < 0 ? String.fromCharCode(r + 65536) : String.fromCharCode(r >> 10 | 55296, r & 1023 | 56320);
}
function Ns(e) {
	return e.replace(Ds, Ms);
}
function Ps(e) {
	return e === 39 || e === 34;
}
function Fs(e) {
	return e === 32 || e === 9 || e === 10 || e === 12 || e === 13;
}
function Is(e) {
	let t = [], n = Ls(t, `${e}`, 0);
	if (n < e.length) throw Error(`Unmatched selector: ${e.slice(n)}`);
	return t;
}
function Ls(e, t, n) {
	let r = [];
	function i(e) {
		let r = t.slice(n + e).match(Es);
		if (!r) throw Error(`Expected name, found ${t.slice(n)}`);
		let [i] = r;
		return n += e + i.length, Ns(i);
	}
	function a(e) {
		for (n += e; n < t.length && Fs(t.charCodeAt(n));) n++;
	}
	function o() {
		n += 1;
		let e = n, r = 1;
		for (; r > 0 && n < t.length; n++) t.charCodeAt(n) === 40 && !s(n) ? r++ : t.charCodeAt(n) === 41 && !s(n) && r--;
		if (r) throw Error("Parenthesis not matched");
		return Ns(t.slice(e, n - 1));
	}
	function s(e) {
		let n = 0;
		for (; t.charCodeAt(--e) === 92;) n++;
		return (n & 1) == 1;
	}
	function c() {
		if (r.length > 0 && As(r[r.length - 1])) throw Error("Did not expect successive traversals.");
	}
	function l(e) {
		if (r.length > 0 && r[r.length - 1].type === X.Descendant) {
			r[r.length - 1].type = e;
			return;
		}
		c(), r.push({ type: e });
	}
	function u(e, t) {
		r.push({
			type: X.Attribute,
			name: e,
			action: t,
			value: i(1),
			namespace: null,
			ignoreCase: "quirks"
		});
	}
	function d() {
		if (r.length && r[r.length - 1].type === X.Descendant && r.pop(), r.length === 0) throw Error("Empty sub-selector");
		e.push(r);
	}
	if (a(0), t.length === n) return n;
	loop: for (; n < t.length;) {
		let e = t.charCodeAt(n);
		switch (e) {
			case 32:
			case 9:
			case 10:
			case 12:
			case 13:
				(r.length === 0 || r[0].type !== X.Descendant) && (c(), r.push({ type: X.Descendant })), a(1);
				break;
			case 62:
				l(X.Child), a(1);
				break;
			case 60:
				l(X.Parent), a(1);
				break;
			case 126:
				l(X.Sibling), a(1);
				break;
			case 43:
				l(X.Adjacent), a(1);
				break;
			case 46:
				u("class", Ts.Element);
				break;
			case 35:
				u("id", Ts.Equals);
				break;
			case 91: {
				a(1);
				let e, o = null;
				t.charCodeAt(n) === 124 ? e = i(1) : t.startsWith("*|", n) ? (o = "*", e = i(2)) : (e = i(0), t.charCodeAt(n) === 124 && t.charCodeAt(n + 1) !== 61 && (o = e, e = i(1))), a(0);
				let c = Ts.Exists, l = Os.get(t.charCodeAt(n));
				if (l) {
					if (c = l, t.charCodeAt(n + 1) !== 61) throw Error("Expected `=`");
					a(2);
				} else t.charCodeAt(n) === 61 && (c = Ts.Equals, a(1));
				let u = "", d = null;
				if (c !== "exists") {
					if (Ps(t.charCodeAt(n))) {
						let e = t.charCodeAt(n), r = n + 1;
						for (; r < t.length && (t.charCodeAt(r) !== e || s(r));) r += 1;
						if (t.charCodeAt(r) !== e) throw Error("Attribute value didn't end");
						u = Ns(t.slice(n + 1, r)), n = r + 1;
					} else {
						let e = n;
						for (; n < t.length && (!Fs(t.charCodeAt(n)) && t.charCodeAt(n) !== 93 || s(n));) n += 1;
						u = Ns(t.slice(e, n));
					}
					a(0);
					let e = t.charCodeAt(n) | 32;
					e === 115 ? (d = !1, a(1)) : e === 105 && (d = !0, a(1));
				}
				if (t.charCodeAt(n) !== 93) throw Error("Attribute selector didn't terminate");
				n += 1;
				let f = {
					type: X.Attribute,
					name: e,
					action: c,
					value: u,
					namespace: o,
					ignoreCase: d
				};
				r.push(f);
				break;
			}
			case 58: {
				if (t.charCodeAt(n + 1) === 58) {
					r.push({
						type: X.PseudoElement,
						name: i(2).toLowerCase(),
						data: t.charCodeAt(n) === 40 ? o() : null
					});
					continue;
				}
				let e = i(1).toLowerCase(), a = null;
				if (t.charCodeAt(n) === 40) if (ks.has(e)) {
					if (Ps(t.charCodeAt(n + 1))) throw Error(`Pseudo-selector ${e} cannot be quoted`);
					if (a = [], n = Ls(a, t, n + 1), t.charCodeAt(n) !== 41) throw Error(`Missing closing parenthesis in :${e} (${t})`);
					n += 1;
				} else {
					if (a = o(), js.has(e)) {
						let e = a.charCodeAt(0);
						e === a.charCodeAt(a.length - 1) && Ps(e) && (a = a.slice(1, -1));
					}
					a = Ns(a);
				}
				r.push({
					type: X.Pseudo,
					name: e,
					data: a
				});
				break;
			}
			case 44:
				d(), r = [], a(1);
				break;
			default: {
				if (t.startsWith("/*", n)) {
					let e = t.indexOf("*/", n + 2);
					if (e < 0) throw Error("Comment was not terminated");
					n = e + 2, r.length === 0 && a(0);
					break;
				}
				let o = null, s;
				if (e === 42) n += 1, s = "*";
				else if (e === 124) {
					if (s = "", t.charCodeAt(n + 1) === 124) {
						l(X.ColumnCombinator), a(2);
						break;
					}
				} else if (Es.test(t.slice(n))) s = i(0);
				else break loop;
				t.charCodeAt(n) === 124 && t.charCodeAt(n + 1) !== 124 && (o = s, t.charCodeAt(n + 1) === 42 ? (s = "*", n += 2) : s = i(1)), r.push(s === "*" ? {
					type: X.Universal,
					namespace: o
				} : {
					type: X.Tag,
					name: s,
					namespace: o
				});
			}
		}
	}
	return d(), n;
}
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/sort.js
var Z = /* @__PURE__ */ u(ws()), Rs = new Map([
	[X.Universal, 50],
	[X.Tag, 30],
	[X.Attribute, 1],
	[X.Pseudo, 0]
]);
function zs(e) {
	return !Rs.has(e.type);
}
var Bs = new Map([
	[Ts.Exists, 10],
	[Ts.Equals, 8],
	[Ts.Not, 7],
	[Ts.Start, 6],
	[Ts.End, 6],
	[Ts.Any, 5]
]);
function Vs(e) {
	let t = e.map(Hs);
	for (let n = 1; n < e.length; n++) {
		let r = t[n];
		if (!(r < 0)) for (let i = n - 1; i >= 0 && r < t[i]; i--) {
			let n = e[i + 1];
			e[i + 1] = e[i], e[i] = n, t[i + 1] = t[i], t[i] = r;
		}
	}
}
function Hs(e) {
	var t, n;
	let r = (t = Rs.get(e.type)) == null ? -1 : t;
	return e.type === X.Attribute ? (r = (n = Bs.get(e.action)) == null ? 4 : n, e.action === Ts.Equals && e.name === "id" && (r = 9), e.ignoreCase && (r >>= 1)) : e.type === X.Pseudo && (e.data ? e.name === "has" || e.name === "contains" ? r = 0 : Array.isArray(e.data) ? (r = Math.min(...e.data.map((e) => Math.min(...e.map(Hs)))), r < 0 && (r = 0)) : r = 2 : r = 3), r;
}
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/attributes.js
var Us = /[-[\]{}()*+?.,\\^$|#\s]/g;
function Ws(e) {
	return e.replace(Us, "\\$&");
}
var Gs = new Set(/* @__PURE__ */ "accept.accept-charset.align.alink.axis.bgcolor.charset.checked.clear.codetype.color.compact.declare.defer.dir.direction.disabled.enctype.face.frame.hreflang.http-equiv.lang.language.link.media.method.multiple.nohref.noresize.noshade.nowrap.readonly.rel.rev.rules.scope.scrolling.selected.shape.target.text.type.valign.valuetype.vlink".split("."));
function Ks(e, t) {
	return typeof e.ignoreCase == "boolean" ? e.ignoreCase : e.ignoreCase === "quirks" ? !!t.quirksMode : !t.xmlMode && Gs.has(e.name);
}
var qs = {
	equals(e, t, n) {
		let { adapter: r } = n, { name: i } = t, { value: a } = t;
		return Ks(t, n) ? (a = a.toLowerCase(), (t) => {
			let n = r.getAttributeValue(t, i);
			return n != null && n.length === a.length && n.toLowerCase() === a && e(t);
		}) : (t) => r.getAttributeValue(t, i) === a && e(t);
	},
	hyphen(e, t, n) {
		let { adapter: r } = n, { name: i } = t, { value: a } = t, o = a.length;
		return Ks(t, n) ? (a = a.toLowerCase(), function(t) {
			let n = r.getAttributeValue(t, i);
			return n != null && (n.length === o || n.charAt(o) === "-") && n.substr(0, o).toLowerCase() === a && e(t);
		}) : function(t) {
			let n = r.getAttributeValue(t, i);
			return n != null && (n.length === o || n.charAt(o) === "-") && n.substr(0, o) === a && e(t);
		};
	},
	element(e, t, n) {
		let { adapter: r } = n, { name: i, value: a } = t;
		if (/\s/.test(a)) return Z.default.falseFunc;
		let o = RegExp(`(?:^|\\s)${Ws(a)}(?:$|\\s)`, Ks(t, n) ? "i" : "");
		return function(t) {
			let n = r.getAttributeValue(t, i);
			return n != null && n.length >= a.length && o.test(n) && e(t);
		};
	},
	exists(e, { name: t }, { adapter: n }) {
		return (r) => n.hasAttrib(r, t) && e(r);
	},
	start(e, t, n) {
		let { adapter: r } = n, { name: i } = t, { value: a } = t, o = a.length;
		return o === 0 ? Z.default.falseFunc : Ks(t, n) ? (a = a.toLowerCase(), (t) => {
			let n = r.getAttributeValue(t, i);
			return n != null && n.length >= o && n.substr(0, o).toLowerCase() === a && e(t);
		}) : (t) => {
			var n;
			return !!((n = r.getAttributeValue(t, i)) != null && n.startsWith(a)) && e(t);
		};
	},
	end(e, t, n) {
		let { adapter: r } = n, { name: i } = t, { value: a } = t, o = -a.length;
		return o === 0 ? Z.default.falseFunc : Ks(t, n) ? (a = a.toLowerCase(), (t) => {
			var n;
			return ((n = r.getAttributeValue(t, i)) == null ? void 0 : n.substr(o).toLowerCase()) === a && e(t);
		}) : (t) => {
			var n;
			return !!((n = r.getAttributeValue(t, i)) != null && n.endsWith(a)) && e(t);
		};
	},
	any(e, t, n) {
		let { adapter: r } = n, { name: i, value: a } = t;
		if (a === "") return Z.default.falseFunc;
		if (Ks(t, n)) {
			let t = new RegExp(Ws(a), "i");
			return function(n) {
				let o = r.getAttributeValue(n, i);
				return o != null && o.length >= a.length && t.test(o) && e(n);
			};
		}
		return (t) => {
			var n;
			return !!((n = r.getAttributeValue(t, i)) != null && n.includes(a)) && e(t);
		};
	},
	not(e, t, n) {
		let { adapter: r } = n, { name: i } = t, { value: a } = t;
		return a === "" ? (t) => !!r.getAttributeValue(t, i) && e(t) : Ks(t, n) ? (a = a.toLowerCase(), (t) => {
			let n = r.getAttributeValue(t, i);
			return (n == null || n.length !== a.length || n.toLowerCase() !== a) && e(t);
		}) : (t) => r.getAttributeValue(t, i) !== a && e(t);
	}
}, Js = new Set([
	9,
	10,
	12,
	13,
	32
]), Ys = 48, Xs = 57;
function Zs(e) {
	if (e = e.trim().toLowerCase(), e === "even") return [2, 0];
	if (e === "odd") return [2, 1];
	let t = 0, n = 0, r = a(), i = o();
	if (t < e.length && e.charAt(t) === "n" && (t++, n = r * (i == null ? 1 : i), s(), t < e.length ? (r = a(), s(), i = o()) : r = i = 0), i === null || t < e.length) throw Error(`n-th rule couldn't be parsed ('${e}')`);
	return [n, r * i];
	function a() {
		return e.charAt(t) === "-" ? (t++, -1) : (e.charAt(t) === "+" && t++, 1);
	}
	function o() {
		let n = t, r = 0;
		for (; t < e.length && e.charCodeAt(t) >= Ys && e.charCodeAt(t) <= Xs;) r = r * 10 + (e.charCodeAt(t) - Ys), t++;
		return t === n ? null : r;
	}
	function s() {
		for (; t < e.length && Js.has(e.charCodeAt(t));) t++;
	}
}
//#endregion
//#region node_modules/.pnpm/nth-check@2.1.1/node_modules/nth-check/lib/esm/compile.js
function Qs(e) {
	let t = e[0], n = e[1] - 1;
	if (n < 0 && t <= 0) return Z.default.falseFunc;
	if (t === -1) return (e) => e <= n;
	if (t === 0) return (e) => e === n;
	if (t === 1) return n < 0 ? Z.default.trueFunc : (e) => e >= n;
	let r = Math.abs(t), i = (n % r + r) % r;
	return t > 1 ? (e) => e >= n && e % r === i : (e) => e <= n && e % r === i;
}
//#endregion
//#region node_modules/.pnpm/nth-check@2.1.1/node_modules/nth-check/lib/esm/index.js
function $s(e) {
	return Qs(Zs(e));
}
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/pseudo-selectors/filters.js
function ec(e, t) {
	return (n) => {
		let r = t.getParent(n);
		return r != null && t.isTag(r) && e(n);
	};
}
var tc = {
	contains(e, t, { adapter: n }) {
		return function(r) {
			return e(r) && n.getText(r).includes(t);
		};
	},
	icontains(e, t, { adapter: n }) {
		let r = t.toLowerCase();
		return function(t) {
			return e(t) && n.getText(t).toLowerCase().includes(r);
		};
	},
	"nth-child"(e, t, { adapter: n, equals: r }) {
		let i = $s(t);
		return i === Z.default.falseFunc ? Z.default.falseFunc : i === Z.default.trueFunc ? ec(e, n) : function(t) {
			let a = n.getSiblings(t), o = 0;
			for (let e = 0; e < a.length && !r(t, a[e]); e++) n.isTag(a[e]) && o++;
			return i(o) && e(t);
		};
	},
	"nth-last-child"(e, t, { adapter: n, equals: r }) {
		let i = $s(t);
		return i === Z.default.falseFunc ? Z.default.falseFunc : i === Z.default.trueFunc ? ec(e, n) : function(t) {
			let a = n.getSiblings(t), o = 0;
			for (let e = a.length - 1; e >= 0 && !r(t, a[e]); e--) n.isTag(a[e]) && o++;
			return i(o) && e(t);
		};
	},
	"nth-of-type"(e, t, { adapter: n, equals: r }) {
		let i = $s(t);
		return i === Z.default.falseFunc ? Z.default.falseFunc : i === Z.default.trueFunc ? ec(e, n) : function(t) {
			let a = n.getSiblings(t), o = 0;
			for (let e = 0; e < a.length; e++) {
				let i = a[e];
				if (r(t, i)) break;
				n.isTag(i) && n.getName(i) === n.getName(t) && o++;
			}
			return i(o) && e(t);
		};
	},
	"nth-last-of-type"(e, t, { adapter: n, equals: r }) {
		let i = $s(t);
		return i === Z.default.falseFunc ? Z.default.falseFunc : i === Z.default.trueFunc ? ec(e, n) : function(t) {
			let a = n.getSiblings(t), o = 0;
			for (let e = a.length - 1; e >= 0; e--) {
				let i = a[e];
				if (r(t, i)) break;
				n.isTag(i) && n.getName(i) === n.getName(t) && o++;
			}
			return i(o) && e(t);
		};
	},
	root(e, t, { adapter: n }) {
		return (t) => {
			let r = n.getParent(t);
			return (r == null || !n.isTag(r)) && e(t);
		};
	},
	scope(e, t, n, r) {
		let { equals: i } = n;
		return !r || r.length === 0 ? tc.root(e, t, n) : r.length === 1 ? (t) => i(r[0], t) && e(t) : (t) => r.includes(t) && e(t);
	},
	hover: nc("isHovered"),
	visited: nc("isVisited"),
	active: nc("isActive")
};
function nc(e) {
	return function(t, n, { adapter: r }) {
		let i = r[e];
		return typeof i == "function" ? function(e) {
			return i(e) && t(e);
		} : Z.default.falseFunc;
	};
}
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/pseudo-selectors/pseudos.js
var rc = {
	empty(e, { adapter: t }) {
		return !t.getChildren(e).some((e) => t.isTag(e) || t.getText(e) !== "");
	},
	"first-child"(e, { adapter: t, equals: n }) {
		if (t.prevElementSibling) return t.prevElementSibling(e) == null;
		let r = t.getSiblings(e).find((e) => t.isTag(e));
		return r != null && n(e, r);
	},
	"last-child"(e, { adapter: t, equals: n }) {
		let r = t.getSiblings(e);
		for (let i = r.length - 1; i >= 0; i--) {
			if (n(e, r[i])) return !0;
			if (t.isTag(r[i])) break;
		}
		return !1;
	},
	"first-of-type"(e, { adapter: t, equals: n }) {
		let r = t.getSiblings(e), i = t.getName(e);
		for (let a = 0; a < r.length; a++) {
			let o = r[a];
			if (n(e, o)) return !0;
			if (t.isTag(o) && t.getName(o) === i) break;
		}
		return !1;
	},
	"last-of-type"(e, { adapter: t, equals: n }) {
		let r = t.getSiblings(e), i = t.getName(e);
		for (let a = r.length - 1; a >= 0; a--) {
			let o = r[a];
			if (n(e, o)) return !0;
			if (t.isTag(o) && t.getName(o) === i) break;
		}
		return !1;
	},
	"only-of-type"(e, { adapter: t, equals: n }) {
		let r = t.getName(e);
		return t.getSiblings(e).every((i) => n(e, i) || !t.isTag(i) || t.getName(i) !== r);
	},
	"only-child"(e, { adapter: t, equals: n }) {
		return t.getSiblings(e).every((r) => n(e, r) || !t.isTag(r));
	}
};
function ic(e, t, n, r) {
	if (n === null) {
		if (e.length > r) throw Error(`Pseudo-class :${t} requires an argument`);
	} else if (e.length === r) throw Error(`Pseudo-class :${t} doesn't have any arguments`);
}
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/pseudo-selectors/aliases.js
var ac = {
	"any-link": ":is(a, area, link)[href]",
	link: ":any-link:not(:visited)",
	disabled: ":is(\n        :is(button, input, select, textarea, optgroup, option)[disabled],\n        optgroup[disabled] > option,\n        fieldset[disabled]:not(fieldset[disabled] legend:first-of-type *)\n    )",
	enabled: ":not(:disabled)",
	checked: ":is(:is(input[type=radio], input[type=checkbox])[checked], option:selected)",
	required: ":is(input, select, textarea)[required]",
	optional: ":is(input, select, textarea):not([required])",
	selected: "option:is([selected], select:not([multiple]):not(:has(> option[selected])) > :first-of-type)",
	checkbox: "[type=checkbox]",
	file: "[type=file]",
	password: "[type=password]",
	radio: "[type=radio]",
	reset: "[type=reset]",
	image: "[type=image]",
	submit: "[type=submit]",
	parent: ":not(:empty)",
	header: ":is(h1, h2, h3, h4, h5, h6)",
	button: ":is(button, input[type=button])",
	input: ":is(input, textarea, select, button)",
	text: "input:is(:not([type!='']), [type=text])"
}, oc = {};
function sc(e, t) {
	return e === Z.default.falseFunc ? Z.default.falseFunc : (n) => t.isTag(n) && e(n);
}
function cc(e, t) {
	let n = t.getSiblings(e);
	if (n.length <= 1) return [];
	let r = n.indexOf(e);
	return r < 0 || r === n.length - 1 ? [] : n.slice(r + 1).filter(t.isTag);
}
function lc(e) {
	return {
		xmlMode: !!e.xmlMode,
		lowerCaseAttributeNames: !!e.lowerCaseAttributeNames,
		lowerCaseTags: !!e.lowerCaseTags,
		quirksMode: !!e.quirksMode,
		cacheResults: !!e.cacheResults,
		pseudos: e.pseudos,
		adapter: e.adapter,
		equals: e.equals
	};
}
var uc = (e, t, n, r, i) => {
	let a = i(t, lc(n), r);
	return a === Z.default.trueFunc ? e : a === Z.default.falseFunc ? Z.default.falseFunc : (t) => a(t) && e(t);
}, dc = {
	is: uc,
	matches: uc,
	where: uc,
	not(e, t, n, r, i) {
		let a = i(t, lc(n), r);
		return a === Z.default.falseFunc ? e : a === Z.default.trueFunc ? Z.default.falseFunc : (t) => !a(t) && e(t);
	},
	has(e, t, n, r, i) {
		let { adapter: a } = n, o = lc(n);
		o.relativeSelector = !0;
		let s = t.some((e) => e.some(zs)) ? [oc] : void 0, c = i(t, o, s);
		if (c === Z.default.falseFunc) return Z.default.falseFunc;
		let l = sc(c, a);
		if (s && c !== Z.default.trueFunc) {
			let { shouldTestNextSiblings: t = !1 } = c;
			return (n) => {
				if (!e(n)) return !1;
				s[0] = n;
				let r = a.getChildren(n), i = t ? [...r, ...cc(n, a)] : r;
				return a.existsOne(l, i);
			};
		}
		return (t) => e(t) && a.existsOne(l, a.getChildren(t));
	}
};
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/pseudo-selectors/index.js
function fc(e, t, n, r, i) {
	var a;
	let { name: o, data: s } = t;
	if (Array.isArray(s)) {
		if (!(o in dc)) throw Error(`Unknown pseudo-class :${o}(${s})`);
		return dc[o](e, s, n, r, i);
	}
	let c = (a = n.pseudos) == null ? void 0 : a[o], l = typeof c == "string" ? c : ac[o];
	if (typeof l == "string") {
		if (s != null) throw Error(`Pseudo ${o} doesn't have any arguments`);
		let t = Is(l);
		return dc.is(e, t, n, r, i);
	}
	if (typeof c == "function") return ic(c, o, s, 1), (t) => c(t, s) && e(t);
	if (o in tc) return tc[o](e, s, n, r);
	if (o in rc) {
		let t = rc[o];
		return ic(t, o, s, 2), (r) => t(r, n, s) && e(r);
	}
	throw Error(`Unknown pseudo-class :${o}`);
}
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/general.js
function pc(e, t) {
	let n = t.getParent(e);
	return n && t.isTag(n) ? n : null;
}
function mc(e, t, n, r, i) {
	let { adapter: a, equals: o } = n;
	switch (t.type) {
		case X.PseudoElement: throw Error("Pseudo-elements are not supported by css-select");
		case X.ColumnCombinator: throw Error("Column combinators are not yet supported by css-select");
		case X.Attribute:
			if (t.namespace != null) throw Error("Namespaced attributes are not yet supported by css-select");
			return (!n.xmlMode || n.lowerCaseAttributeNames) && (t.name = t.name.toLowerCase()), qs[t.action](e, t, n);
		case X.Pseudo: return fc(e, t, n, r, i);
		case X.Tag: {
			if (t.namespace != null) throw Error("Namespaced tag names are not yet supported by css-select");
			let { name: r } = t;
			return (!n.xmlMode || n.lowerCaseTags) && (r = r.toLowerCase()), function(t) {
				return a.getName(t) === r && e(t);
			};
		}
		case X.Descendant: {
			if (n.cacheResults === !1 || typeof WeakSet > "u") return function(t) {
				let n = t;
				for (; n = pc(n, a);) if (e(n)) return !0;
				return !1;
			};
			let t = /* @__PURE__ */ new WeakSet();
			return function(n) {
				let r = n;
				for (; r = pc(r, a);) if (!t.has(r)) {
					if (a.isTag(r) && e(r)) return !0;
					t.add(r);
				}
				return !1;
			};
		}
		case "_flexibleDescendant": return function(t) {
			let n = t;
			do
				if (e(n)) return !0;
			while (n = pc(n, a));
			return !1;
		};
		case X.Parent: return function(t) {
			return a.getChildren(t).some((t) => a.isTag(t) && e(t));
		};
		case X.Child: return function(t) {
			let n = a.getParent(t);
			return n != null && a.isTag(n) && e(n);
		};
		case X.Sibling: return function(t) {
			let n = a.getSiblings(t);
			for (let r = 0; r < n.length; r++) {
				let i = n[r];
				if (o(t, i)) break;
				if (a.isTag(i) && e(i)) return !0;
			}
			return !1;
		};
		case X.Adjacent: return a.prevElementSibling ? function(t) {
			let n = a.prevElementSibling(t);
			return n != null && e(n);
		} : function(t) {
			let n = a.getSiblings(t), r;
			for (let e = 0; e < n.length; e++) {
				let i = n[e];
				if (o(t, i)) break;
				a.isTag(i) && (r = i);
			}
			return !!r && e(r);
		};
		case X.Universal:
			if (t.namespace != null && t.namespace !== "*") throw Error("Namespaced universal selectors are not yet supported by css-select");
			return e;
	}
}
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/compile.js
function hc(e, t, n) {
	return sc(gc(e, t, n), t.adapter);
}
function gc(e, t, n) {
	return Sc(typeof e == "string" ? Is(e) : e, t, n);
}
function _c(e) {
	return e.type === X.Pseudo && (e.name === "scope" || Array.isArray(e.data) && e.data.some((e) => e.some(_c)));
}
var vc = { type: X.Descendant }, yc = { type: "_flexibleDescendant" }, bc = {
	type: X.Pseudo,
	name: "scope",
	data: null
};
function xc(e, { adapter: t }, n) {
	let r = !!(n != null && n.every((e) => {
		let n = t.isTag(e) && t.getParent(e);
		return e === oc || n && t.isTag(n);
	}));
	for (let t of e) {
		if (!(t.length > 0 && zs(t[0]) && t[0].type !== X.Descendant)) if (r && !t.some(_c)) t.unshift(vc);
		else continue;
		t.unshift(bc);
	}
}
function Sc(e, t, n) {
	var r;
	e.forEach(Vs), n = (r = t.context) == null ? n : r;
	let i = Array.isArray(n), a = n && (Array.isArray(n) ? n : [n]);
	if (t.relativeSelector !== !1) xc(e, t, a);
	else if (e.some((e) => e.length > 0 && zs(e[0]))) throw Error("Relative selectors are not allowed when the `relativeSelector` option is disabled");
	let o = !1, s = e.map((e) => {
		if (e.length >= 2) {
			let [t, n] = e;
			t.type !== X.Pseudo || t.name !== "scope" || (i && n.type === X.Descendant ? e[1] = yc : (n.type === X.Adjacent || n.type === X.Sibling) && (o = !0));
		}
		return Cc(e, t, a);
	}).reduce(wc, Z.default.falseFunc);
	return s.shouldTestNextSiblings = o, s;
}
function Cc(e, t, n) {
	var r;
	return e.reduce((e, r) => e === Z.default.falseFunc ? Z.default.falseFunc : mc(e, r, t, n, Sc), (r = t.rootFunc) == null ? Z.default.trueFunc : r);
}
function wc(e, t) {
	return t === Z.default.falseFunc || e === Z.default.trueFunc ? e : e === Z.default.falseFunc || t === Z.default.trueFunc ? t : function(n) {
		return e(n) || t(n);
	};
}
//#endregion
//#region node_modules/.pnpm/css-select@5.1.0/node_modules/css-select/lib/esm/index.js
var Tc = (e, t) => e === t, Ec = {
	adapter: Cs,
	equals: Tc
};
function Dc(e) {
	var t, n;
	let r = e == null ? Ec : e;
	return r.adapter != null || (r.adapter = Cs), r.equals != null || (r.equals = (n = (t = r.adapter) == null ? void 0 : t.equals) == null ? Tc : n), r;
}
function Oc(e) {
	return function(t, n, r) {
		return e(t, Dc(n), r);
	};
}
var kc = Oc(hc);
function Ac(e, t, n) {
	let r = Dc(n);
	return (typeof t == "function" ? t : hc(t, r))(e);
}
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/shared/matches.js
var { isArray: jc } = Array, Mc = ({ nodeType: e }) => e === 1, Nc = (e, t) => t.some((t) => Mc(t) && (e(t) || Nc(e, Fc(t)))), Pc = (e, t) => t === "class" ? e.classList.value : e.getAttribute(t), Fc = ({ childNodes: e }) => e, Ic = (e) => {
	let { localName: t } = e;
	return sa(e) ? t.toLowerCase() : t;
}, Lc = ({ parentNode: e }) => e, Rc = (e) => {
	let { parentNode: t } = e;
	return t ? Fc(t) : e;
}, zc = (e) => jc(e) ? e.map(zc).join("") : Mc(e) ? zc(Fc(e)) : e.nodeType === 3 ? e.data : "", Bc = (e, t) => e.hasAttribute(t), Vc = (e) => {
	let { length: t } = e;
	for (; t--;) {
		let n = e[t];
		if (t && -1 < e.lastIndexOf(n, t - 1)) {
			e.splice(t, 1);
			continue;
		}
		for (let { parentNode: r } = n; r; r = r.parentNode) if (e.includes(r)) {
			e.splice(t, 1);
			break;
		}
	}
	return e;
}, Hc = (e, t) => {
	let n = [];
	for (let r of t) Mc(r) && (e(r) && n.push(r), n.push(...Hc(e, Fc(r))));
	return n;
}, Uc = (e, t) => {
	for (let n of t) if (e(n) || (n = Uc(e, Fc(n)))) return n;
	return null;
}, Wc = {
	isTag: Mc,
	existsOne: Nc,
	getAttributeValue: Pc,
	getChildren: Fc,
	getName: Ic,
	getParent: Lc,
	getSiblings: Rc,
	getText: zc,
	hasAttrib: Bc,
	removeSubsets: Vc,
	findAll: Hc,
	findOne: Uc
}, Gc = (e, t) => kc(t, {
	context: t.includes(":scope") ? e : void 0,
	xmlMode: !sa(e),
	adapter: Wc
}), Kc = (e, t) => Ac(e, t, {
	strict: !0,
	context: t.includes(":scope") ? e : void 0,
	xmlMode: !sa(e),
	adapter: Wc
}), qc = class e extends bo {
	constructor(e, t = "") {
		super(e, "#text", 3, t);
	}
	get wholeText() {
		let e = [], { previousSibling: t, nextSibling: n } = this;
		for (; t && t.nodeType === 3;) e.unshift(t[dn]), t = t.previousSibling;
		for (e.push(this[dn]); n && n.nodeType === 3;) e.push(n[dn]), n = n.nextSibling;
		return e.join("");
	}
	cloneNode() {
		let { ownerDocument: t, [dn]: n } = this;
		return new e(t, n);
	}
	toString() {
		return ao(this[dn]);
	}
}, Jc = (e) => e instanceof eo, Yc = (e, t, n) => {
	let { ownerDocument: r } = e;
	for (let i of n) e.insertBefore(Jc(i) ? i : new qc(r, i), t);
}, Xc = class extends eo {
	constructor(e, t, n) {
		super(e, t, n), this[on] = null, this[G] = this[W] = {
			[G]: null,
			[an]: this,
			[cn]: this,
			nodeType: -1,
			ownerDocument: this.ownerDocument,
			parentNode: null
		};
	}
	get childNodes() {
		let e = new Qa(), { firstChild: t } = this;
		for (; t;) e.push(t), t = fo(t);
		return e;
	}
	get children() {
		let e = new Qa(), { firstElementChild: t } = this;
		for (; t;) e.push(t), t = po(t);
		return e;
	}
	get firstChild() {
		let { [G]: e, [W]: t } = this;
		for (; e.nodeType === 2;) e = e[G];
		return e === t ? null : e;
	}
	get firstElementChild() {
		let { firstChild: e } = this;
		for (; e;) {
			if (e.nodeType === 1) return e;
			e = fo(e);
		}
		return null;
	}
	get lastChild() {
		let e = this[W][an];
		switch (e.nodeType) {
			case -1: return e[cn];
			case 2: return null;
		}
		return e === this ? null : e;
	}
	get lastElementChild() {
		let { lastChild: e } = this;
		for (; e;) {
			if (e.nodeType === 1) return e;
			e = uo(e);
		}
		return null;
	}
	get childElementCount() {
		return this.children.length;
	}
	prepend(...e) {
		Yc(this, this.firstChild, e);
	}
	append(...e) {
		Yc(this, this[W], e);
	}
	replaceChildren(...e) {
		let { [G]: t, [W]: n } = this;
		for (; t !== n && t.nodeType === 2;) t = t[G];
		for (; t !== n;) {
			let e = oa(t)[G];
			t.remove(), t = e;
		}
		e.length && Yc(this, n, e);
	}
	getElementsByClassName(e) {
		let t = new Qa(), { [G]: n, [W]: r } = this;
		for (; n !== r;) n.nodeType === 1 && n.hasAttribute("class") && n.classList.has(e) && t.push(n), n = n[G];
		return t;
	}
	getElementsByTagName(e) {
		let t = new Qa(), { [G]: n, [W]: r } = this;
		for (; n !== r;) n.nodeType === 1 && (n.localName === e || fa(n) === e) && t.push(n), n = n[G];
		return t;
	}
	querySelector(e) {
		let t = Gc(this, e), { [G]: n, [W]: r } = this;
		for (; n !== r;) {
			if (n.nodeType === 1 && t(n)) return n;
			n = n.nodeType === 1 && n.localName === "template" ? n[W] : n[G];
		}
		return null;
	}
	querySelectorAll(e) {
		let t = Gc(this, e), n = new Qa(), { [G]: r, [W]: i } = this;
		for (; r !== i;) r.nodeType === 1 && t(r) && n.push(r), r = r.nodeType === 1 && r.localName === "template" ? r[W] : r[G];
		return n;
	}
	appendChild(e) {
		return this.insertBefore(e, this[W]);
	}
	contains(e) {
		let t = e;
		for (; t && t !== this;) t = t.parentNode;
		return t === this;
	}
	insertBefore(e, t = null) {
		if (e === t) return e;
		if (e === this) throw Error("unable to append a node to itself");
		let n = t || this[W];
		switch (e.nodeType) {
			case 1:
				e.remove(), e.parentNode = this, la(n[an], e, n), Va(e, null), Sa(e);
				break;
			case 11: {
				let { [on]: t, firstChild: r, lastChild: i } = e;
				if (r) {
					ua(n[an], r, i, n), ca(e, e[W]), t && t.replaceChildren();
					do
						r.parentNode = this, Va(r, null), r.nodeType === 1 && Sa(r);
					while (r !== i && (r = fo(r)));
				}
				break;
			}
			case 3:
			case 8:
			case 4: e.remove();
			default:
				e.parentNode = this, da(n[an], e, n), Va(e, null);
				break;
		}
		return e;
	}
	normalize() {
		let { [G]: e, [W]: t } = this;
		for (; e !== t;) {
			let { [G]: t, [an]: n, nodeType: r } = e;
			r === 3 && (e[dn] ? n && n.nodeType === 3 && (n.textContent += e.textContent, e.remove()) : e.remove()), e = t;
		}
	}
	removeChild(e) {
		if (e.parentNode !== this) throw Error("node is not a child");
		return e.remove(), e;
	}
	replaceChild(e, t) {
		let n = oa(t)[G];
		return t.remove(), this.insertBefore(e, n), t;
	}
}, Zc = class extends Xc {
	getElementById(e) {
		let { [G]: t, [W]: n } = this;
		for (; t !== n;) {
			if (t.nodeType === 1 && t.id === e) return t;
			t = t[G];
		}
		return null;
	}
	cloneNode(e) {
		let { ownerDocument: t, constructor: n } = this, r = new n(t);
		if (e) {
			let { [W]: t } = r;
			for (let n of this.childNodes) r.insertBefore(n.cloneNode(e), t);
		}
		return r;
	}
	toString() {
		let { childNodes: e, localName: t } = this;
		return `<${t}>${e.join("")}</${t}>`;
	}
	toJSON() {
		let e = [];
		return Fa(this, e), e;
	}
}, Qc = class extends Zc {
	constructor(e) {
		super(e, "#document-fragment", 11);
	}
}, $c = class e extends eo {
	constructor(e, t, n = "", r = "") {
		super(e, "#document-type", 10), this.name = t, this.publicId = n, this.systemId = r;
	}
	cloneNode() {
		let { ownerDocument: t, name: n, publicId: r, systemId: i } = this;
		return new e(t, n, r, i);
	}
	toString() {
		let { name: e, publicId: t, systemId: n } = this, r = 0 < t.length, i = [e];
		return r && i.push("PUBLIC", `"${t}"`), n.length && (r || i.push("SYSTEM"), i.push(`"${n}"`)), `<!DOCTYPE ${i.join(" ")}>`;
	}
	toJSON() {
		let e = [];
		return Ia(this, e), e;
	}
}, el = (e) => e.childNodes.join(""), tl = (e, t) => {
	let { ownerDocument: n } = e, { constructor: r } = n, i = new r();
	i[qt] = n[qt];
	let { childNodes: a } = ka(i, sa(e), t);
	e.replaceChildren(...a.map(nl, n));
};
function nl(e) {
	switch (e.ownerDocument = this, e.nodeType) {
		case 1:
		case 11:
			e.childNodes.forEach(nl, this);
			break;
	}
	return e;
}
//#endregion
//#region node_modules/.pnpm/uhyphen@0.2.0/node_modules/uhyphen/esm/index.js
var rl = (e) => e.replace(/(([A-Z0-9])([A-Z0-9][a-z]))|(([a-z0-9]+)([A-Z]))/g, "$2$5-$3$6").toLowerCase(), il = /* @__PURE__ */ new WeakMap(), al = (e) => `data-${rl(e)}`, ol = (e) => e.slice(5).replace(/-([a-z])/g, (e, t) => t.toUpperCase()), sl = {
	get(e, t) {
		if (t in e) return il.get(e).getAttribute(al(t));
	},
	set(e, t, n) {
		return e[t] = n, il.get(e).setAttribute(al(t), n), !0;
	},
	deleteProperty(e, t) {
		return t in e && il.get(e).removeAttribute(al(t)), delete e[t];
	}
}, cl = class {
	constructor(e) {
		for (let { name: t, value: n } of e.attributes) /^data-/.test(t) && (this[ol(t)] = n);
		return il.set(this, e), new Proxy(this, sl);
	}
};
ia(cl.prototype, null);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/dom/token-list.js
var { add: ll } = Set.prototype, ul = (e, t) => {
	for (let n of t) n && ll.call(e, n);
}, dl = ({ [rn]: e, value: t }) => {
	let n = e.getAttributeNode("class");
	n ? n.value = t : Wa(e, new so(e.ownerDocument, "class", t));
}, fl = class extends Set {
	constructor(e) {
		super(), this[rn] = e;
		let t = e.getAttributeNode("class");
		t && ul(this, t.value.split(/\s+/));
	}
	get length() {
		return this.size;
	}
	get value() {
		return [...this].join(" ");
	}
	add(...e) {
		ul(this, e), dl(this);
	}
	contains(e) {
		return this.has(e);
	}
	remove(...e) {
		for (let t of e) this.delete(t);
		dl(this);
	}
	toggle(e, t) {
		if (this.has(e)) {
			if (t) return !0;
			this.delete(e), dl(this);
		} else if (t || arguments.length === 1) return super.add(e), dl(this), !0;
		return !1;
	}
	replace(e, t) {
		return this.has(e) ? (this.delete(e), super.add(t), dl(this), !0) : !1;
	}
	supports() {
		return !0;
	}
}, pl = /* @__PURE__ */ new WeakMap(), ml = (e) => [...e.keys()].filter((e) => e !== on), hl = (e) => {
	let t = pl.get(e).getAttributeNode("style");
	if ((!t || t[Gt] || e.get(on) !== t) && (e.clear(), t)) {
		e.set(on, t);
		for (let n of t[dn].split(/\s*;\s*/)) {
			let [t, ...r] = n.split(":");
			if (r.length > 0) {
				t = t.trim();
				let n = r.join(":").trim();
				t && n && e.set(t, n);
			}
		}
	}
	return t;
}, gl = {
	get(e, t) {
		return t in vl ? e[t] : (hl(e), t === "length" ? ml(e).length : /^\d+$/.test(t) ? ml(e)[t] : e.get(rl(t)));
	},
	set(e, t, n) {
		if (t === "cssText") e[t] = n;
		else {
			let r = hl(e);
			if (n == null ? e.delete(rl(t)) : e.set(rl(t), n), !r) {
				let t = pl.get(e);
				r = t.ownerDocument.createAttribute("style"), t.setAttributeNode(r), e.set(on, r);
			}
			r[Gt] = !1, r[dn] = e.toString();
		}
		return !0;
	}
}, _l = class extends Map {
	constructor(e) {
		/* c8 ignore start */
		return super(), pl.set(this, e), new Proxy(this, gl);
		/* c8 ignore stop */
	}
	get cssText() {
		return this.toString();
	}
	set cssText(e) {
		pl.get(this).setAttribute("style", e);
	}
	getPropertyValue(e) {
		let t = this[on];
		return gl.get(t, e);
	}
	setProperty(e, t) {
		let n = this[on];
		gl.set(n, e, t);
	}
	removeProperty(e) {
		let t = this[on];
		gl.set(t, e, null);
	}
	[Symbol.iterator]() {
		let e = this[on];
		hl(e);
		let t = ml(e), { length: n } = t, r = 0;
		return { next() {
			let e = r === n;
			return {
				done: e,
				value: e ? null : t[r++]
			};
		} };
	}
	get [on]() {
		return this;
	}
	toString() {
		let e = this[on];
		hl(e);
		let t = [];
		return e.forEach(yl, t), t.join(";");
	}
}, { prototype: vl } = _l;
function yl(e, t) {
	t !== on && this.push(`${t}:${e}`);
}
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/interface/event.js
/* c8 ignore start */
var bl = 3, xl = 2, Sl = 1, Cl = 0;
function wl(e) {
	return e.currentTarget;
}
var Tl = class {
	static get BUBBLING_PHASE() {
		return bl;
	}
	static get AT_TARGET() {
		return xl;
	}
	static get CAPTURING_PHASE() {
		return Sl;
	}
	static get NONE() {
		return Cl;
	}
	constructor(e, t = {}) {
		this.type = e, this.bubbles = !!t.bubbles, this.cancelBubble = !1, this._stopImmediatePropagationFlag = !1, this.cancelable = !!t.cancelable, this.eventPhase = this.NONE, this.timeStamp = Date.now(), this.defaultPrevented = !1, this.originalTarget = null, this.returnValue = null, this.srcElement = null, this.target = null, this._path = [];
	}
	get BUBBLING_PHASE() {
		return bl;
	}
	get AT_TARGET() {
		return xl;
	}
	get CAPTURING_PHASE() {
		return Sl;
	}
	get NONE() {
		return Cl;
	}
	preventDefault() {
		this.defaultPrevented = !0;
	}
	composedPath() {
		return this._path.map(wl);
	}
	stopPropagation() {
		this.cancelBubble = !0;
	}
	stopImmediatePropagation() {
		this.stopPropagation(), this._stopImmediatePropagationFlag = !0;
	}
}, El = class extends Array {
	constructor(e) {
		super(), this.ownerElement = e;
	}
	getNamedItem(e) {
		return this.ownerElement.getAttributeNode(e);
	}
	setNamedItem(e) {
		this.ownerElement.setAttributeNode(e), this.unshift(e);
	}
	removeNamedItem(e) {
		let t = this.getNamedItem(e);
		this.ownerElement.removeAttribute(e), this.splice(this.indexOf(t), 1);
	}
	item(e) {
		return e < this.length ? this[e] : null;
	}
	/* c8 ignore start */
	getNamedItemNS(e, t) {
		return this.getNamedItem(t);
	}
	setNamedItemNS(e, t) {
		return this.setNamedItem(t);
	}
	removeNamedItemNS(e, t) {
		return this.removeNamedItem(t);
	}
}, Dl = class extends Zc {
	constructor(e) {
		super(e.ownerDocument, "#shadow-root", 11), this.host = e;
	}
	get innerHTML() {
		return el(this);
	}
	set innerHTML(e) {
		tl(this, e);
	}
}, Ol = { get(e, t) {
	return t in e ? e[t] : e.find(({ name: e }) => e === t);
} }, kl = (e, t, n) => {
	if ("ownerSVGElement" in t) {
		let r = e.createElementNS(Zi, n);
		return r.ownerSVGElement = t.ownerSVGElement, r;
	}
	return e.createElement(n);
}, Al = ({ localName: e, ownerDocument: t }) => t[tn].voidElements.test(e), jl = class extends Xc {
	constructor(e, t) {
		super(e, t, 1), this[Kt] = null, this[Yt] = null, this[ln] = null;
	}
	get isConnected() {
		return co(this);
	}
	get parentElement() {
		return lo(this);
	}
	get previousSibling() {
		return uo(this);
	}
	get nextSibling() {
		return fo(this);
	}
	get namespaceURI() {
		return "http://www.w3.org/1999/xhtml";
	}
	get previousElementSibling() {
		return mo(this);
	}
	get nextElementSibling() {
		return po(this);
	}
	before(...e) {
		go(this, e);
	}
	after(...e) {
		_o(this, e);
	}
	replaceWith(...e) {
		vo(this, e);
	}
	remove() {
		yo(this[an], this, this[W][G]);
	}
	get id() {
		return Y.get(this, "id");
	}
	set id(e) {
		Y.set(this, "id", e);
	}
	get className() {
		return this.classList.value;
	}
	set className(e) {
		let { classList: t } = this;
		t.clear(), t.add(...aa(e).split(/\s+/));
	}
	get nodeName() {
		return fa(this);
	}
	get tagName() {
		return fa(this);
	}
	get classList() {
		return this[Kt] || (this[Kt] = new fl(this));
	}
	get dataset() {
		return this[Yt] || (this[Yt] = new cl(this));
	}
	getBoundingClientRect() {
		return {
			x: 0,
			y: 0,
			bottom: 0,
			height: 0,
			left: 0,
			right: 0,
			top: 0,
			width: 0
		};
	}
	get nonce() {
		return Y.get(this, "nonce");
	}
	set nonce(e) {
		Y.set(this, "nonce", e);
	}
	get style() {
		return this[ln] || (this[ln] = new _l(this));
	}
	get tabIndex() {
		return qa.get(this, "tabindex") || -1;
	}
	set tabIndex(e) {
		qa.set(this, "tabindex", e);
	}
	get slot() {
		return Y.get(this, "slot");
	}
	set slot(e) {
		Y.set(this, "slot", e);
	}
	get innerText() {
		let e = [], { [G]: t, [W]: n } = this;
		for (; t !== n;) t.nodeType === 3 ? e.push(t.textContent.replace(/\s+/g, " ")) : e.length && t[G] != n && Xi.has(t.tagName) && e.push("\n"), t = t[G];
		return e.join("");
	}
	get textContent() {
		let e = [], { [G]: t, [W]: n } = this;
		for (; t !== n;) {
			let n = t.nodeType;
			(n === 3 || n === 4) && e.push(t.textContent), t = t[G];
		}
		return e.join("");
	}
	set textContent(e) {
		this.replaceChildren(), e != null && e !== "" && this.appendChild(new qc(this.ownerDocument, e));
	}
	get innerHTML() {
		return el(this);
	}
	set innerHTML(e) {
		tl(this, e);
	}
	get outerHTML() {
		return this.toString();
	}
	set outerHTML(e) {
		let t = this.ownerDocument.createElement("");
		t.innerHTML = e, this.replaceWith(...t.childNodes);
	}
	get attributes() {
		let e = new El(this), t = this[G];
		for (; t.nodeType === 2;) e.push(t), t = t[G];
		return new Proxy(e, Ol);
	}
	focus() {
		this.dispatchEvent(new Tl("focus"));
	}
	getAttribute(e) {
		if (e === "class") return this.className;
		let t = this.getAttributeNode(e);
		return t && (sa(this) ? t.value : ao(t.value));
	}
	getAttributeNode(e) {
		let t = this[G];
		for (; t.nodeType === 2;) {
			if (t.name === e) return t;
			t = t[G];
		}
		return null;
	}
	getAttributeNames() {
		let e = new Qa(), t = this[G];
		for (; t.nodeType === 2;) e.push(t.name), t = t[G];
		return e;
	}
	hasAttribute(e) {
		return !!this.getAttributeNode(e);
	}
	hasAttributes() {
		return this[G].nodeType === 2;
	}
	removeAttribute(e) {
		e === "class" && this[Kt] && this[Kt].clear();
		let t = this[G];
		for (; t.nodeType === 2;) {
			if (t.name === e) {
				Ga(this, t);
				return;
			}
			t = t[G];
		}
	}
	removeAttributeNode(e) {
		let t = this[G];
		for (; t.nodeType === 2;) {
			if (t === e) {
				Ga(this, t);
				return;
			}
			t = t[G];
		}
	}
	setAttribute(e, t) {
		if (e === "class") this.className = t;
		else {
			let n = this.getAttributeNode(e);
			n ? n.value = t : Wa(this, new so(this.ownerDocument, e, t));
		}
	}
	setAttributeNode(e) {
		let { name: t } = e, n = this.getAttributeNode(t);
		if (n !== e) {
			n && this.removeAttributeNode(n);
			let { ownerElement: t } = e;
			t && t.removeAttributeNode(e), Wa(this, e);
		}
		return n;
	}
	toggleAttribute(e, t) {
		return this.hasAttribute(e) ? t ? !0 : (this.removeAttribute(e), !1) : t || arguments.length === 1 ? (this.setAttribute(e, ""), !0) : !1;
	}
	get shadowRoot() {
		if (ha.has(this)) {
			let { mode: e, shadowRoot: t } = ha.get(this);
			if (e === "open") return t;
		}
		return null;
	}
	attachShadow(e) {
		if (ha.has(this)) throw Error("operation not supported");
		let t = new Dl(this);
		return ha.set(this, {
			mode: e.mode,
			shadowRoot: t
		}), t;
	}
	matches(e) {
		return Kc(this, e);
	}
	closest(e) {
		let t = this, n = Gc(t, e);
		for (; t && !n(t);) t = t.parentElement;
		return t;
	}
	insertAdjacentElement(e, t) {
		let { parentElement: n } = this;
		switch (e) {
			case "beforebegin":
				if (n) {
					n.insertBefore(t, this);
					break;
				}
				return null;
			case "afterbegin":
				this.insertBefore(t, this.firstChild);
				break;
			case "beforeend":
				this.insertBefore(t, null);
				break;
			case "afterend":
				if (n) {
					n.insertBefore(t, this.nextSibling);
					break;
				}
				return null;
		}
		return t;
	}
	insertAdjacentHTML(e, t) {
		this.insertAdjacentElement(e, ma(this.ownerDocument, t));
	}
	insertAdjacentText(e, t) {
		let n = this.ownerDocument.createTextNode(t);
		this.insertAdjacentElement(e, n);
	}
	cloneNode(e = !1) {
		let { ownerDocument: t, localName: n } = this, r = (e) => {
			e.parentNode = a, ca(o, e), o = e;
		}, i = kl(t, this, n), a = i, o = i, { [G]: s, [W]: c } = this;
		for (; s !== c && (e || s.nodeType === 2);) {
			switch (s.nodeType) {
				case -1:
					ca(o, a[W]), o = a[W], a = a.parentNode;
					break;
				case 1: {
					let e = kl(t, s, s.localName);
					r(e), a = e;
					break;
				}
				case 2: {
					let t = s.cloneNode(e);
					t.ownerElement = a, r(t);
					break;
				}
				case 3:
				case 8:
				case 4:
					r(s.cloneNode(e));
					break;
			}
			s = s[G];
		}
		return ca(o, i[W]), i;
	}
	toString() {
		let e = [], { [W]: t } = this, n = { [G]: this }, r = !1;
		do
			switch (n = n[G], n.nodeType) {
				case 2: {
					let t = " " + n;
					switch (t) {
						case " id":
						case " class":
						case " style": break;
						default: e.push(t);
					}
					break;
				}
				case -1: {
					let t = n[cn];
					r ? ("ownerSVGElement" in t ? e.push(" />") : Al(t) ? e.push(sa(t) ? ">" : " />") : e.push(`></${t.localName}>`), r = !1) : e.push(`</${t.localName}>`);
					break;
				}
				case 1:
					r && e.push(">"), n.toString === this.toString ? (e.push(`<${n.localName}`), r = !0) : (e.push(n.toString()), n = n[W], r = !1);
					break;
				case 3:
				case 8:
				case 4:
					e.push((r ? ">" : "") + n), r = !1;
					break;
			}
		while (n !== t);
		return e.join("");
	}
	toJSON() {
		let e = [];
		return La(this, e), e;
	}
	/* c8 ignore start */
	getAttributeNS(e, t) {
		return this.getAttribute(t);
	}
	getElementsByTagNameNS(e, t) {
		return this.getElementsByTagName(t);
	}
	hasAttributeNS(e, t) {
		return this.hasAttribute(t);
	}
	removeAttributeNS(e, t) {
		this.removeAttribute(t);
	}
	setAttributeNS(e, t, n) {
		this.setAttribute(t, n);
	}
	setAttributeNodeNS(e) {
		return this.setAttributeNode(e);
	}
}, Ml = /* @__PURE__ */ new WeakMap(), Nl = {
	get(e, t) {
		return e[t];
	},
	set(e, t, n) {
		return e[t] = n, !0;
	}
}, Pl = class extends jl {
	constructor(e, t, n = null) {
		super(e, t), this.ownerSVGElement = n;
	}
	get className() {
		return Ml.has(this) || Ml.set(this, new Proxy({
			baseVal: "",
			animVal: ""
		}, Nl)), Ml.get(this);
	}
	/* c8 ignore start */
	set className(e) {
		let { classList: t } = this;
		t.clear(), t.add(...aa(e).split(/\s+/));
	}
	/* c8 ignore stop */
	get namespaceURI() {
		return "http://www.w3.org/2000/svg";
	}
	getAttribute(e) {
		return e === "class" ? [...this.classList].join(" ") : super.getAttribute(e);
	}
	setAttribute(e, t) {
		if (e === "class") this.className = t;
		else if (e === "style") {
			let { className: e } = this;
			e.baseVal = e.animVal = t;
		}
		super.setAttribute(e, t);
	}
}, Fl = () => {
	throw TypeError("Illegal constructor");
};
function Il() {
	Fl();
}
ia(Il, so), Il.prototype = so.prototype;
function Ll() {
	Fl();
}
ia(Ll, xo), Ll.prototype = xo.prototype;
function Rl() {
	Fl();
}
ia(Rl, bo), Rl.prototype = bo.prototype;
function zl() {
	Fl();
}
ia(zl, So), zl.prototype = So.prototype;
function Bl() {
	Fl();
}
ia(Bl, Qc), Bl.prototype = Qc.prototype;
function Vl() {
	Fl();
}
ia(Vl, $c), Vl.prototype = $c.prototype;
function Hl() {
	Fl();
}
ia(Hl, jl), Hl.prototype = jl.prototype;
function Ul() {
	Fl();
}
ia(Ul, eo), Ul.prototype = eo.prototype;
function Wl() {
	Fl();
}
ia(Wl, Dl), Wl.prototype = Dl.prototype;
function Gl() {
	Fl();
}
ia(Gl, qc), Gl.prototype = qc.prototype;
function Kl() {
	Fl();
}
ia(Kl, Pl), Kl.prototype = Pl.prototype;
/* c8 ignore stop */
var ql = {
	Attr: Il,
	CDATASection: Ll,
	CharacterData: Rl,
	Comment: zl,
	DocumentFragment: Bl,
	DocumentType: Vl,
	Element: Hl,
	Node: Ul,
	ShadowRoot: Wl,
	Text: Gl,
	SVGElement: Kl
}, Jl = /* @__PURE__ */ new WeakMap(), Q = {
	get(e, t) {
		return Jl.has(e) && Jl.get(e)[t] || null;
	},
	set(e, t, n) {
		Jl.has(e) || Jl.set(e, {});
		let r = Jl.get(e), i = t.slice(2);
		r[t] && e.removeEventListener(i, r[t], !1), (r[t] = n) && e.addEventListener(i, n, !1);
	}
}, $ = class extends jl {
	static get observedAttributes() {
		return [];
	}
	constructor(e = null, t = "") {
		super(e, t);
		let n = !e, r;
		if (n) {
			let { constructor: n } = this;
			if (!_a.has(n)) throw Error("unable to initialize this Custom Element");
			({ownerDocument: e, localName: t, options: r} = _a.get(n));
		}
		if (e[un]) {
			let { element: t, values: n } = e[un];
			e[un] = null;
			for (let [e, r] of n) t[e] = r;
			return t;
		}
		n && (this.ownerDocument = this[W].ownerDocument = e, this.localName = t, va.set(this, { connected: !1 }), r.is && this.setAttribute("is", r.is));
	}
	/* c8 ignore start */
	blur() {
		this.dispatchEvent(new Tl("blur"));
	}
	click() {
		let e = new Tl("click", {
			bubbles: !0,
			cancelable: !0
		});
		e.button = 0, this.dispatchEvent(e);
	}
	get accessKeyLabel() {
		let { accessKey: e } = this;
		return e && `Alt+Shift+${e}`;
	}
	get isContentEditable() {
		return this.hasAttribute("contenteditable");
	}
	get contentEditable() {
		return Ka.get(this, "contenteditable");
	}
	set contentEditable(e) {
		Ka.set(this, "contenteditable", e);
	}
	get draggable() {
		return Ka.get(this, "draggable");
	}
	set draggable(e) {
		Ka.set(this, "draggable", e);
	}
	get hidden() {
		return Ka.get(this, "hidden");
	}
	set hidden(e) {
		Ka.set(this, "hidden", e);
	}
	get spellcheck() {
		return Ka.get(this, "spellcheck");
	}
	set spellcheck(e) {
		Ka.set(this, "spellcheck", e);
	}
	get accessKey() {
		return Y.get(this, "accesskey");
	}
	set accessKey(e) {
		Y.set(this, "accesskey", e);
	}
	get dir() {
		return Y.get(this, "dir");
	}
	set dir(e) {
		Y.set(this, "dir", e);
	}
	get lang() {
		return Y.get(this, "lang");
	}
	set lang(e) {
		Y.set(this, "lang", e);
	}
	get title() {
		return Y.get(this, "title");
	}
	set title(e) {
		Y.set(this, "title", e);
	}
	get onabort() {
		return Q.get(this, "onabort");
	}
	set onabort(e) {
		Q.set(this, "onabort", e);
	}
	get onblur() {
		return Q.get(this, "onblur");
	}
	set onblur(e) {
		Q.set(this, "onblur", e);
	}
	get oncancel() {
		return Q.get(this, "oncancel");
	}
	set oncancel(e) {
		Q.set(this, "oncancel", e);
	}
	get oncanplay() {
		return Q.get(this, "oncanplay");
	}
	set oncanplay(e) {
		Q.set(this, "oncanplay", e);
	}
	get oncanplaythrough() {
		return Q.get(this, "oncanplaythrough");
	}
	set oncanplaythrough(e) {
		Q.set(this, "oncanplaythrough", e);
	}
	get onchange() {
		return Q.get(this, "onchange");
	}
	set onchange(e) {
		Q.set(this, "onchange", e);
	}
	get onclick() {
		return Q.get(this, "onclick");
	}
	set onclick(e) {
		Q.set(this, "onclick", e);
	}
	get onclose() {
		return Q.get(this, "onclose");
	}
	set onclose(e) {
		Q.set(this, "onclose", e);
	}
	get oncontextmenu() {
		return Q.get(this, "oncontextmenu");
	}
	set oncontextmenu(e) {
		Q.set(this, "oncontextmenu", e);
	}
	get oncuechange() {
		return Q.get(this, "oncuechange");
	}
	set oncuechange(e) {
		Q.set(this, "oncuechange", e);
	}
	get ondblclick() {
		return Q.get(this, "ondblclick");
	}
	set ondblclick(e) {
		Q.set(this, "ondblclick", e);
	}
	get ondrag() {
		return Q.get(this, "ondrag");
	}
	set ondrag(e) {
		Q.set(this, "ondrag", e);
	}
	get ondragend() {
		return Q.get(this, "ondragend");
	}
	set ondragend(e) {
		Q.set(this, "ondragend", e);
	}
	get ondragenter() {
		return Q.get(this, "ondragenter");
	}
	set ondragenter(e) {
		Q.set(this, "ondragenter", e);
	}
	get ondragleave() {
		return Q.get(this, "ondragleave");
	}
	set ondragleave(e) {
		Q.set(this, "ondragleave", e);
	}
	get ondragover() {
		return Q.get(this, "ondragover");
	}
	set ondragover(e) {
		Q.set(this, "ondragover", e);
	}
	get ondragstart() {
		return Q.get(this, "ondragstart");
	}
	set ondragstart(e) {
		Q.set(this, "ondragstart", e);
	}
	get ondrop() {
		return Q.get(this, "ondrop");
	}
	set ondrop(e) {
		Q.set(this, "ondrop", e);
	}
	get ondurationchange() {
		return Q.get(this, "ondurationchange");
	}
	set ondurationchange(e) {
		Q.set(this, "ondurationchange", e);
	}
	get onemptied() {
		return Q.get(this, "onemptied");
	}
	set onemptied(e) {
		Q.set(this, "onemptied", e);
	}
	get onended() {
		return Q.get(this, "onended");
	}
	set onended(e) {
		Q.set(this, "onended", e);
	}
	get onerror() {
		return Q.get(this, "onerror");
	}
	set onerror(e) {
		Q.set(this, "onerror", e);
	}
	get onfocus() {
		return Q.get(this, "onfocus");
	}
	set onfocus(e) {
		Q.set(this, "onfocus", e);
	}
	get oninput() {
		return Q.get(this, "oninput");
	}
	set oninput(e) {
		Q.set(this, "oninput", e);
	}
	get oninvalid() {
		return Q.get(this, "oninvalid");
	}
	set oninvalid(e) {
		Q.set(this, "oninvalid", e);
	}
	get onkeydown() {
		return Q.get(this, "onkeydown");
	}
	set onkeydown(e) {
		Q.set(this, "onkeydown", e);
	}
	get onkeypress() {
		return Q.get(this, "onkeypress");
	}
	set onkeypress(e) {
		Q.set(this, "onkeypress", e);
	}
	get onkeyup() {
		return Q.get(this, "onkeyup");
	}
	set onkeyup(e) {
		Q.set(this, "onkeyup", e);
	}
	get onload() {
		return Q.get(this, "onload");
	}
	set onload(e) {
		Q.set(this, "onload", e);
	}
	get onloadeddata() {
		return Q.get(this, "onloadeddata");
	}
	set onloadeddata(e) {
		Q.set(this, "onloadeddata", e);
	}
	get onloadedmetadata() {
		return Q.get(this, "onloadedmetadata");
	}
	set onloadedmetadata(e) {
		Q.set(this, "onloadedmetadata", e);
	}
	get onloadstart() {
		return Q.get(this, "onloadstart");
	}
	set onloadstart(e) {
		Q.set(this, "onloadstart", e);
	}
	get onmousedown() {
		return Q.get(this, "onmousedown");
	}
	set onmousedown(e) {
		Q.set(this, "onmousedown", e);
	}
	get onmouseenter() {
		return Q.get(this, "onmouseenter");
	}
	set onmouseenter(e) {
		Q.set(this, "onmouseenter", e);
	}
	get onmouseleave() {
		return Q.get(this, "onmouseleave");
	}
	set onmouseleave(e) {
		Q.set(this, "onmouseleave", e);
	}
	get onmousemove() {
		return Q.get(this, "onmousemove");
	}
	set onmousemove(e) {
		Q.set(this, "onmousemove", e);
	}
	get onmouseout() {
		return Q.get(this, "onmouseout");
	}
	set onmouseout(e) {
		Q.set(this, "onmouseout", e);
	}
	get onmouseover() {
		return Q.get(this, "onmouseover");
	}
	set onmouseover(e) {
		Q.set(this, "onmouseover", e);
	}
	get onmouseup() {
		return Q.get(this, "onmouseup");
	}
	set onmouseup(e) {
		Q.set(this, "onmouseup", e);
	}
	get onmousewheel() {
		return Q.get(this, "onmousewheel");
	}
	set onmousewheel(e) {
		Q.set(this, "onmousewheel", e);
	}
	get onpause() {
		return Q.get(this, "onpause");
	}
	set onpause(e) {
		Q.set(this, "onpause", e);
	}
	get onplay() {
		return Q.get(this, "onplay");
	}
	set onplay(e) {
		Q.set(this, "onplay", e);
	}
	get onplaying() {
		return Q.get(this, "onplaying");
	}
	set onplaying(e) {
		Q.set(this, "onplaying", e);
	}
	get onprogress() {
		return Q.get(this, "onprogress");
	}
	set onprogress(e) {
		Q.set(this, "onprogress", e);
	}
	get onratechange() {
		return Q.get(this, "onratechange");
	}
	set onratechange(e) {
		Q.set(this, "onratechange", e);
	}
	get onreset() {
		return Q.get(this, "onreset");
	}
	set onreset(e) {
		Q.set(this, "onreset", e);
	}
	get onresize() {
		return Q.get(this, "onresize");
	}
	set onresize(e) {
		Q.set(this, "onresize", e);
	}
	get onscroll() {
		return Q.get(this, "onscroll");
	}
	set onscroll(e) {
		Q.set(this, "onscroll", e);
	}
	get onseeked() {
		return Q.get(this, "onseeked");
	}
	set onseeked(e) {
		Q.set(this, "onseeked", e);
	}
	get onseeking() {
		return Q.get(this, "onseeking");
	}
	set onseeking(e) {
		Q.set(this, "onseeking", e);
	}
	get onselect() {
		return Q.get(this, "onselect");
	}
	set onselect(e) {
		Q.set(this, "onselect", e);
	}
	get onshow() {
		return Q.get(this, "onshow");
	}
	set onshow(e) {
		Q.set(this, "onshow", e);
	}
	get onstalled() {
		return Q.get(this, "onstalled");
	}
	set onstalled(e) {
		Q.set(this, "onstalled", e);
	}
	get onsubmit() {
		return Q.get(this, "onsubmit");
	}
	set onsubmit(e) {
		Q.set(this, "onsubmit", e);
	}
	get onsuspend() {
		return Q.get(this, "onsuspend");
	}
	set onsuspend(e) {
		Q.set(this, "onsuspend", e);
	}
	get ontimeupdate() {
		return Q.get(this, "ontimeupdate");
	}
	set ontimeupdate(e) {
		Q.set(this, "ontimeupdate", e);
	}
	get ontoggle() {
		return Q.get(this, "ontoggle");
	}
	set ontoggle(e) {
		Q.set(this, "ontoggle", e);
	}
	get onvolumechange() {
		return Q.get(this, "onvolumechange");
	}
	set onvolumechange(e) {
		Q.set(this, "onvolumechange", e);
	}
	get onwaiting() {
		return Q.get(this, "onwaiting");
	}
	set onwaiting(e) {
		Q.set(this, "onwaiting", e);
	}
	get onauxclick() {
		return Q.get(this, "onauxclick");
	}
	set onauxclick(e) {
		Q.set(this, "onauxclick", e);
	}
	get ongotpointercapture() {
		return Q.get(this, "ongotpointercapture");
	}
	set ongotpointercapture(e) {
		Q.set(this, "ongotpointercapture", e);
	}
	get onlostpointercapture() {
		return Q.get(this, "onlostpointercapture");
	}
	set onlostpointercapture(e) {
		Q.set(this, "onlostpointercapture", e);
	}
	get onpointercancel() {
		return Q.get(this, "onpointercancel");
	}
	set onpointercancel(e) {
		Q.set(this, "onpointercancel", e);
	}
	get onpointerdown() {
		return Q.get(this, "onpointerdown");
	}
	set onpointerdown(e) {
		Q.set(this, "onpointerdown", e);
	}
	get onpointerenter() {
		return Q.get(this, "onpointerenter");
	}
	set onpointerenter(e) {
		Q.set(this, "onpointerenter", e);
	}
	get onpointerleave() {
		return Q.get(this, "onpointerleave");
	}
	set onpointerleave(e) {
		Q.set(this, "onpointerleave", e);
	}
	get onpointermove() {
		return Q.get(this, "onpointermove");
	}
	set onpointermove(e) {
		Q.set(this, "onpointermove", e);
	}
	get onpointerout() {
		return Q.get(this, "onpointerout");
	}
	set onpointerout(e) {
		Q.set(this, "onpointerout", e);
	}
	get onpointerover() {
		return Q.get(this, "onpointerover");
	}
	set onpointerover(e) {
		Q.set(this, "onpointerover", e);
	}
	get onpointerup() {
		return Q.get(this, "onpointerup");
	}
	set onpointerup(e) {
		Q.set(this, "onpointerup", e);
	}
}, Yl = "template", Xl = class extends $ {
	constructor(e) {
		super(e, Yl);
		let t = this.ownerDocument.createDocumentFragment();
		(this[Jt] = t)[on] = this;
	}
	get content() {
		if (this.hasChildNodes() && !this[Jt].hasChildNodes()) for (let e of this.childNodes) this[Jt].appendChild(e.cloneNode(!0));
		return this[Jt];
	}
};
ja(Yl, Xl);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/html-element.js
var Zl = class extends $ {
	constructor(e, t = "html") {
		super(e, t);
	}
}, { toString: Ql } = $.prototype, $l = class extends $ {
	get innerHTML() {
		return this.textContent;
	}
	set innerHTML(e) {
		this.textContent = e;
	}
	toString() {
		return Ql.call(this.cloneNode()).replace("><", () => `>${this.textContent}<`);
	}
}, eu = "script", tu = class extends $l {
	constructor(e, t = eu) {
		super(e, t);
	}
	get type() {
		return Y.get(this, "type");
	}
	set type(e) {
		Y.set(this, "type", e);
	}
	get src() {
		return Y.get(this, "src");
	}
	set src(e) {
		Y.set(this, "src", e);
	}
	get defer() {
		return Ka.get(this, "defer");
	}
	set defer(e) {
		Ka.set(this, "defer", e);
	}
	get crossOrigin() {
		return Y.get(this, "crossorigin");
	}
	set crossOrigin(e) {
		Y.set(this, "crossorigin", e);
	}
	get nomodule() {
		return Ka.get(this, "nomodule");
	}
	set nomodule(e) {
		Ka.set(this, "nomodule", e);
	}
	get referrerPolicy() {
		return Y.get(this, "referrerpolicy");
	}
	set referrerPolicy(e) {
		Y.set(this, "referrerpolicy", e);
	}
	get nonce() {
		return Y.get(this, "nonce");
	}
	set nonce(e) {
		Y.set(this, "nonce", e);
	}
	get async() {
		return Ka.get(this, "async");
	}
	set async(e) {
		Ka.set(this, "async", e);
	}
	get text() {
		return this.textContent;
	}
	set text(e) {
		this.textContent = e;
	}
};
ja(eu, tu);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/frame-element.js
var nu = class extends $ {
	constructor(e, t = "frame") {
		super(e, t);
	}
}, ru = "iframe", iu = class extends $ {
	constructor(e, t = ru) {
		super(e, t);
	}
	/* c8 ignore start */
	get src() {
		return Y.get(this, "src");
	}
	set src(e) {
		Y.set(this, "src", e);
	}
	get srcdoc() {
		return Y.get(this, "srcdoc");
	}
	set srcdoc(e) {
		Y.set(this, "srcdoc", e);
	}
	get name() {
		return Y.get(this, "name");
	}
	set name(e) {
		Y.set(this, "name", e);
	}
	get allow() {
		return Y.get(this, "allow");
	}
	set allow(e) {
		Y.set(this, "allow", e);
	}
	get allowFullscreen() {
		return Ka.get(this, "allowfullscreen");
	}
	set allowFullscreen(e) {
		Ka.set(this, "allowfullscreen", e);
	}
	get referrerPolicy() {
		return Y.get(this, "referrerpolicy");
	}
	set referrerPolicy(e) {
		Y.set(this, "referrerpolicy", e);
	}
	get loading() {
		return Y.get(this, "loading");
	}
	set loading(e) {
		Y.set(this, "loading", e);
	}
};
ja(ru, iu);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/object-element.js
var au = class extends $ {
	constructor(e, t = "object") {
		super(e, t);
	}
}, ou = class extends $ {
	constructor(e, t = "head") {
		super(e, t);
	}
}, su = class extends $ {
	constructor(e, t = "body") {
		super(e, t);
	}
}, cu = /* @__PURE__ */ s(((e) => {
	var t = {};
	t.StyleSheet = function() {
		this.parentStyleSheet = null;
	}, e.StyleSheet = t.StyleSheet;
})), lu = /* @__PURE__ */ s(((e) => {
	var t = {};
	t.CSSRule = function() {
		this.parentRule = null, this.parentStyleSheet = null;
	}, t.CSSRule.UNKNOWN_RULE = 0, t.CSSRule.STYLE_RULE = 1, t.CSSRule.CHARSET_RULE = 2, t.CSSRule.IMPORT_RULE = 3, t.CSSRule.MEDIA_RULE = 4, t.CSSRule.FONT_FACE_RULE = 5, t.CSSRule.PAGE_RULE = 6, t.CSSRule.KEYFRAMES_RULE = 7, t.CSSRule.KEYFRAME_RULE = 8, t.CSSRule.MARGIN_RULE = 9, t.CSSRule.NAMESPACE_RULE = 10, t.CSSRule.COUNTER_STYLE_RULE = 11, t.CSSRule.SUPPORTS_RULE = 12, t.CSSRule.DOCUMENT_RULE = 13, t.CSSRule.FONT_FEATURE_VALUES_RULE = 14, t.CSSRule.VIEWPORT_RULE = 15, t.CSSRule.REGION_STYLE_RULE = 16, t.CSSRule.prototype = { constructor: t.CSSRule }, e.CSSRule = t.CSSRule;
})), uu = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSStyleDeclaration: Du().CSSStyleDeclaration,
		CSSRule: lu().CSSRule
	};
	t.CSSStyleRule = function() {
		t.CSSRule.call(this), this.selectorText = "", this.style = new t.CSSStyleDeclaration(), this.style.parentRule = this;
	}, t.CSSStyleRule.prototype = new t.CSSRule(), t.CSSStyleRule.prototype.constructor = t.CSSStyleRule, t.CSSStyleRule.prototype.type = 1, Object.defineProperty(t.CSSStyleRule.prototype, "cssText", {
		get: function() {
			return this.selectorText ? this.selectorText + " {" + this.style.cssText + "}" : "";
		},
		set: function(e) {
			var n = t.CSSStyleRule.parse(e);
			this.style = n.style, this.selectorText = n.selectorText;
		}
	}), t.CSSStyleRule.parse = function(e) {
		for (var n = 0, r = "selector", i, a = n, o = "", s = {
			selector: !0,
			value: !0
		}, c = new t.CSSStyleRule(), l, u = "", d; d = e.charAt(n); n++) switch (d) {
			case " ":
			case "	":
			case "\r":
			case "\n":
			case "\f":
				if (s[r]) switch (e.charAt(n - 1)) {
					case " ":
					case "	":
					case "\r":
					case "\n":
					case "\f": break;
					default:
						o += " ";
						break;
				}
				break;
			case "\"":
				if (a = n + 1, i = e.indexOf("\"", a) + 1, !i) throw "\" is missing";
				o += e.slice(n, i), n = i - 1;
				break;
			case "'":
				if (a = n + 1, i = e.indexOf("'", a) + 1, !i) throw "' is missing";
				o += e.slice(n, i), n = i - 1;
				break;
			case "/":
				if (e.charAt(n + 1) === "*") {
					if (n += 2, i = e.indexOf("*/", n), i === -1) throw SyntaxError("Missing */");
					n = i + 1;
				} else o += d;
				break;
			case "{":
				r === "selector" && (c.selectorText = o.trim(), o = "", r = "name");
				break;
			case ":":
				r === "name" ? (l = o.trim(), o = "", r = "value") : o += d;
				break;
			case "!":
				r === "value" && e.indexOf("!important", n) === n ? (u = "important", n += 9) : o += d;
				break;
			case ";":
				r === "value" ? (c.style.setProperty(l, o.trim(), u), u = "", o = "", r = "name") : o += d;
				break;
			case "}":
				if (r === "value") c.style.setProperty(l, o.trim(), u), u = "", o = "";
				else if (r === "name") break;
				else o += d;
				r = "selector";
				break;
			default:
				o += d;
				break;
		}
		return c;
	}, e.CSSStyleRule = t.CSSStyleRule;
})), du = /* @__PURE__ */ s(((e) => {
	var t = {
		StyleSheet: cu().StyleSheet,
		CSSStyleRule: uu().CSSStyleRule
	};
	t.CSSStyleSheet = function() {
		t.StyleSheet.call(this), this.cssRules = [];
	}, t.CSSStyleSheet.prototype = new t.StyleSheet(), t.CSSStyleSheet.prototype.constructor = t.CSSStyleSheet, t.CSSStyleSheet.prototype.insertRule = function(e, n) {
		if (n < 0 || n > this.cssRules.length) throw RangeError("INDEX_SIZE_ERR");
		var r = t.parse(e).cssRules[0];
		return r.parentStyleSheet = this, this.cssRules.splice(n, 0, r), n;
	}, t.CSSStyleSheet.prototype.deleteRule = function(e) {
		if (e < 0 || e >= this.cssRules.length) throw RangeError("INDEX_SIZE_ERR");
		this.cssRules.splice(e, 1);
	}, t.CSSStyleSheet.prototype.toString = function() {
		for (var e = "", t = this.cssRules, n = 0; n < t.length; n++) e += t[n].cssText + "\n";
		return e;
	}, e.CSSStyleSheet = t.CSSStyleSheet, t.parse = Eu().parse;
})), fu = /* @__PURE__ */ s(((e) => {
	var t = {};
	t.MediaList = function() {
		this.length = 0;
	}, t.MediaList.prototype = {
		constructor: t.MediaList,
		get mediaText() {
			return Array.prototype.join.call(this, ", ");
		},
		set mediaText(e) {
			for (var t = e.split(","), n = this.length = t.length, r = 0; r < n; r++) this[r] = t[r].trim();
		},
		appendMedium: function(e) {
			Array.prototype.indexOf.call(this, e) === -1 && (this[this.length] = e, this.length++);
		},
		deleteMedium: function(e) {
			var t = Array.prototype.indexOf.call(this, e);
			t !== -1 && Array.prototype.splice.call(this, t, 1);
		}
	}, e.MediaList = t.MediaList;
})), pu = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSRule: lu().CSSRule,
		CSSStyleSheet: du().CSSStyleSheet,
		MediaList: fu().MediaList
	};
	t.CSSImportRule = function() {
		t.CSSRule.call(this), this.href = "", this.media = new t.MediaList(), this.styleSheet = new t.CSSStyleSheet();
	}, t.CSSImportRule.prototype = new t.CSSRule(), t.CSSImportRule.prototype.constructor = t.CSSImportRule, t.CSSImportRule.prototype.type = 3, Object.defineProperty(t.CSSImportRule.prototype, "cssText", {
		get: function() {
			var e = this.media.mediaText;
			return "@import url(" + this.href + ")" + (e ? " " + e : "") + ";";
		},
		set: function(e) {
			for (var t = 0, n = "", r = "", i, a; a = e.charAt(t); t++) switch (a) {
				case " ":
				case "	":
				case "\r":
				case "\n":
				case "\f":
					n === "after-import" ? n = "url" : r += a;
					break;
				case "@":
					!n && e.indexOf("@import", t) === t && (n = "after-import", t += 6, r = "");
					break;
				case "u":
					if (n === "url" && e.indexOf("url(", t) === t) {
						if (i = e.indexOf(")", t + 1), i === -1) throw t + ": \")\" not found";
						t += 4;
						var o = e.slice(t, i);
						o[0] === o[o.length - 1] && (o[0] === "\"" || o[0] === "'") && (o = o.slice(1, -1)), this.href = o, t = i, n = "media";
					}
					break;
				case "\"":
					if (n === "url") {
						if (i = e.indexOf("\"", t + 1), !i) throw t + ": '\"' not found";
						this.href = e.slice(t + 1, i), t = i, n = "media";
					}
					break;
				case "'":
					if (n === "url") {
						if (i = e.indexOf("'", t + 1), !i) throw t + ": \"'\" not found";
						this.href = e.slice(t + 1, i), t = i, n = "media";
					}
					break;
				case ";":
					n === "media" && r && (this.media.mediaText = r.trim());
					break;
				default:
					n === "media" && (r += a);
					break;
			}
		}
	}), e.CSSImportRule = t.CSSImportRule;
})), mu = /* @__PURE__ */ s(((e) => {
	var t = { CSSRule: lu().CSSRule };
	t.CSSGroupingRule = function() {
		t.CSSRule.call(this), this.cssRules = [];
	}, t.CSSGroupingRule.prototype = new t.CSSRule(), t.CSSGroupingRule.prototype.constructor = t.CSSGroupingRule, t.CSSGroupingRule.prototype.insertRule = function(e, n) {
		if (n < 0 || n > this.cssRules.length) throw RangeError("INDEX_SIZE_ERR");
		var r = t.parse(e).cssRules[0];
		return r.parentRule = this, this.cssRules.splice(n, 0, r), n;
	}, t.CSSGroupingRule.prototype.deleteRule = function(e) {
		if (e < 0 || e >= this.cssRules.length) throw RangeError("INDEX_SIZE_ERR");
		this.cssRules.splice(e, 1)[0].parentRule = null;
	}, e.CSSGroupingRule = t.CSSGroupingRule;
})), hu = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSRule: lu().CSSRule,
		CSSGroupingRule: mu().CSSGroupingRule
	};
	t.CSSConditionRule = function() {
		t.CSSGroupingRule.call(this), this.cssRules = [];
	}, t.CSSConditionRule.prototype = new t.CSSGroupingRule(), t.CSSConditionRule.prototype.constructor = t.CSSConditionRule, t.CSSConditionRule.prototype.conditionText = "", t.CSSConditionRule.prototype.cssText = "", e.CSSConditionRule = t.CSSConditionRule;
})), gu = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSRule: lu().CSSRule,
		CSSGroupingRule: mu().CSSGroupingRule,
		CSSConditionRule: hu().CSSConditionRule,
		MediaList: fu().MediaList
	};
	t.CSSMediaRule = function() {
		t.CSSConditionRule.call(this), this.media = new t.MediaList();
	}, t.CSSMediaRule.prototype = new t.CSSConditionRule(), t.CSSMediaRule.prototype.constructor = t.CSSMediaRule, t.CSSMediaRule.prototype.type = 4, Object.defineProperties(t.CSSMediaRule.prototype, {
		conditionText: {
			get: function() {
				return this.media.mediaText;
			},
			set: function(e) {
				this.media.mediaText = e;
			},
			configurable: !0,
			enumerable: !0
		},
		cssText: {
			get: function() {
				for (var e = [], t = 0, n = this.cssRules.length; t < n; t++) e.push(this.cssRules[t].cssText);
				return "@media " + this.media.mediaText + " {" + e.join("") + "}";
			},
			configurable: !0,
			enumerable: !0
		}
	}), e.CSSMediaRule = t.CSSMediaRule;
})), _u = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSRule: lu().CSSRule,
		CSSGroupingRule: mu().CSSGroupingRule,
		CSSConditionRule: hu().CSSConditionRule
	};
	t.CSSSupportsRule = function() {
		t.CSSConditionRule.call(this);
	}, t.CSSSupportsRule.prototype = new t.CSSConditionRule(), t.CSSSupportsRule.prototype.constructor = t.CSSSupportsRule, t.CSSSupportsRule.prototype.type = 12, Object.defineProperty(t.CSSSupportsRule.prototype, "cssText", { get: function() {
		for (var e = [], t = 0, n = this.cssRules.length; t < n; t++) e.push(this.cssRules[t].cssText);
		return "@supports " + this.conditionText + " {" + e.join("") + "}";
	} }), e.CSSSupportsRule = t.CSSSupportsRule;
})), vu = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSStyleDeclaration: Du().CSSStyleDeclaration,
		CSSRule: lu().CSSRule
	};
	t.CSSFontFaceRule = function() {
		t.CSSRule.call(this), this.style = new t.CSSStyleDeclaration(), this.style.parentRule = this;
	}, t.CSSFontFaceRule.prototype = new t.CSSRule(), t.CSSFontFaceRule.prototype.constructor = t.CSSFontFaceRule, t.CSSFontFaceRule.prototype.type = 5, Object.defineProperty(t.CSSFontFaceRule.prototype, "cssText", { get: function() {
		return "@font-face {" + this.style.cssText + "}";
	} }), e.CSSFontFaceRule = t.CSSFontFaceRule;
})), yu = /* @__PURE__ */ s(((e) => {
	var t = { CSSRule: lu().CSSRule };
	t.CSSHostRule = function() {
		t.CSSRule.call(this), this.cssRules = [];
	}, t.CSSHostRule.prototype = new t.CSSRule(), t.CSSHostRule.prototype.constructor = t.CSSHostRule, t.CSSHostRule.prototype.type = 1001, Object.defineProperty(t.CSSHostRule.prototype, "cssText", { get: function() {
		for (var e = [], t = 0, n = this.cssRules.length; t < n; t++) e.push(this.cssRules[t].cssText);
		return "@host {" + e.join("") + "}";
	} }), e.CSSHostRule = t.CSSHostRule;
})), bu = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSRule: lu().CSSRule,
		CSSStyleDeclaration: Du().CSSStyleDeclaration
	};
	t.CSSKeyframeRule = function() {
		t.CSSRule.call(this), this.keyText = "", this.style = new t.CSSStyleDeclaration(), this.style.parentRule = this;
	}, t.CSSKeyframeRule.prototype = new t.CSSRule(), t.CSSKeyframeRule.prototype.constructor = t.CSSKeyframeRule, t.CSSKeyframeRule.prototype.type = 8, Object.defineProperty(t.CSSKeyframeRule.prototype, "cssText", { get: function() {
		return this.keyText + " {" + this.style.cssText + "} ";
	} }), e.CSSKeyframeRule = t.CSSKeyframeRule;
})), xu = /* @__PURE__ */ s(((e) => {
	var t = { CSSRule: lu().CSSRule };
	t.CSSKeyframesRule = function() {
		t.CSSRule.call(this), this.name = "", this.cssRules = [];
	}, t.CSSKeyframesRule.prototype = new t.CSSRule(), t.CSSKeyframesRule.prototype.constructor = t.CSSKeyframesRule, t.CSSKeyframesRule.prototype.type = 7, Object.defineProperty(t.CSSKeyframesRule.prototype, "cssText", { get: function() {
		for (var e = [], t = 0, n = this.cssRules.length; t < n; t++) e.push("  " + this.cssRules[t].cssText);
		return "@" + (this._vendorPrefix || "") + "keyframes " + this.name + " { \n" + e.join("\n") + "\n}";
	} }), e.CSSKeyframesRule = t.CSSKeyframesRule;
})), Su = /* @__PURE__ */ s(((e) => {
	var t = {};
	t.CSSValue = function() {}, t.CSSValue.prototype = {
		constructor: t.CSSValue,
		set cssText(e) {
			var t = this._getConstructorName();
			throw Error("DOMException: property \"cssText\" of \"" + t + "\" is readonly and can not be replaced with \"" + e + "\"!");
		},
		get cssText() {
			var e = this._getConstructorName();
			throw Error("getter \"cssText\" of \"" + e + "\" is not implemented!");
		},
		_getConstructorName: function() {
			return this.constructor.toString().match(/function\s([^\(]+)/)[1];
		}
	}, e.CSSValue = t.CSSValue;
})), Cu = /* @__PURE__ */ s(((e) => {
	var t = { CSSValue: Su().CSSValue };
	t.CSSValueExpression = function(e, t) {
		this._token = e, this._idx = t;
	}, t.CSSValueExpression.prototype = new t.CSSValue(), t.CSSValueExpression.prototype.constructor = t.CSSValueExpression, t.CSSValueExpression.prototype.parse = function() {
		for (var e = this._token, t = this._idx, n = "", r = "", i = "", a, o = [];; ++t) {
			if (n = e.charAt(t), n === "") {
				i = "css expression error: unfinished expression!";
				break;
			}
			switch (n) {
				case "(":
					o.push(n), r += n;
					break;
				case ")":
					o.pop(n), r += n;
					break;
				case "/":
					(a = this._parseJSComment(e, t)) ? a.error ? i = "css expression error: unfinished comment in expression!" : t = a.idx : (a = this._parseJSRexExp(e, t)) ? (t = a.idx, r += a.text) : r += n;
					break;
				case "'":
				case "\"":
					a = this._parseJSString(e, t, n), a ? (t = a.idx, r += a.text) : r += n;
					break;
				default:
					r += n;
					break;
			}
			if (i || o.length === 0) break;
		}
		return i ? { error: i } : {
			idx: t,
			expression: r
		};
	}, t.CSSValueExpression.prototype._parseJSComment = function(e, t) {
		var n = e.charAt(t + 1), r;
		if (n === "/" || n === "*") {
			var i = t, a, o;
			return n === "/" ? o = "\n" : n === "*" && (o = "*/"), a = e.indexOf(o, i + 1 + 1), a === -1 ? { error: "css expression error: unfinished comment in expression!" } : (a = a + o.length - 1, r = e.substring(t, a + 1), {
				idx: a,
				text: r
			});
		} else return !1;
	}, t.CSSValueExpression.prototype._parseJSString = function(e, t, n) {
		var r = this._findMatchedIdx(e, t, n), i;
		return r === -1 ? !1 : (i = e.substring(t, r + n.length), {
			idx: r,
			text: i
		});
	}, t.CSSValueExpression.prototype._parseJSRexExp = function(e, t) {
		var n = e.substring(0, t).replace(/\s+$/, "");
		return [
			/^$/,
			/\($/,
			/\[$/,
			/\!$/,
			/\+$/,
			/\-$/,
			/\*$/,
			/\/\s+/,
			/\%$/,
			/\=$/,
			/\>$/,
			/<$/,
			/\&$/,
			/\|$/,
			/\^$/,
			/\~$/,
			/\?$/,
			/\,$/,
			/delete$/,
			/in$/,
			/instanceof$/,
			/new$/,
			/typeof$/,
			/void$/
		].some(function(e) {
			return e.test(n);
		}) ? this._parseJSString(e, t, "/") : !1;
	}, t.CSSValueExpression.prototype._findMatchedIdx = function(e, t, n) {
		for (var r = t, i, a = -1;;) if (i = e.indexOf(n, r + 1), i === -1) {
			i = a;
			break;
		} else {
			var o = e.substring(t + 1, i).match(/\\+$/);
			if (!o || o[0] % 2 == 0) break;
			r = i;
		}
		return e.indexOf("\n", t + 1) < i && (i = a), i;
	}, e.CSSValueExpression = t.CSSValueExpression;
})), wu = /* @__PURE__ */ s(((e) => {
	var t = {};
	t.MatcherList = function() {
		this.length = 0;
	}, t.MatcherList.prototype = {
		constructor: t.MatcherList,
		get matcherText() {
			return Array.prototype.join.call(this, ", ");
		},
		set matcherText(e) {
			for (var t = e.split(","), n = this.length = t.length, r = 0; r < n; r++) this[r] = t[r].trim();
		},
		appendMatcher: function(e) {
			Array.prototype.indexOf.call(this, e) === -1 && (this[this.length] = e, this.length++);
		},
		deleteMatcher: function(e) {
			var t = Array.prototype.indexOf.call(this, e);
			t !== -1 && Array.prototype.splice.call(this, t, 1);
		}
	}, e.MatcherList = t.MatcherList;
})), Tu = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSRule: lu().CSSRule,
		MatcherList: wu().MatcherList
	};
	t.CSSDocumentRule = function() {
		t.CSSRule.call(this), this.matcher = new t.MatcherList(), this.cssRules = [];
	}, t.CSSDocumentRule.prototype = new t.CSSRule(), t.CSSDocumentRule.prototype.constructor = t.CSSDocumentRule, t.CSSDocumentRule.prototype.type = 10, Object.defineProperty(t.CSSDocumentRule.prototype, "cssText", { get: function() {
		for (var e = [], t = 0, n = this.cssRules.length; t < n; t++) e.push(this.cssRules[t].cssText);
		return "@-moz-document " + this.matcher.matcherText + " {" + e.join("") + "}";
	} }), e.CSSDocumentRule = t.CSSDocumentRule;
})), Eu = /* @__PURE__ */ s(((e) => {
	var t = {};
	t.parse = function(e) {
		for (var n = 0, r = "before-selector", i, a = "", o = 0, s = {
			selector: !0,
			value: !0,
			"value-parenthesis": !0,
			atRule: !0,
			"importRule-begin": !0,
			importRule: !0,
			atBlock: !0,
			conditionBlock: !0,
			"documentRule-begin": !0
		}, c = new t.CSSStyleSheet(), l = c, u, d = [], f = !1, p, m, h = "", g, _, v, y, b, x, S, C, w = /@(-(?:\w+-)+)?keyframes/g, T = function(t) {
			var r = e.substring(0, n).split("\n"), i = r.length, a = r.pop().length + 1, o = /* @__PURE__ */ Error(t + " (line " + i + ", char " + a + ")");
			throw o.line = i, o.char = a, o.styleSheet = c, o;
		}, E; E = e.charAt(n); n++) switch (E) {
			case " ":
			case "	":
			case "\r":
			case "\n":
			case "\f":
				s[r] && (a += E);
				break;
			case "\"":
				i = n + 1;
				do
					i = e.indexOf("\"", i) + 1, i || T("Unmatched \"");
				while (e[i - 2] === "\\");
				switch (a += e.slice(n, i), n = i - 1, r) {
					case "before-value":
						r = "value";
						break;
					case "importRule-begin":
						r = "importRule";
						break;
				}
				break;
			case "'":
				i = n + 1;
				do
					i = e.indexOf("'", i) + 1, i || T("Unmatched '");
				while (e[i - 2] === "\\");
				switch (a += e.slice(n, i), n = i - 1, r) {
					case "before-value":
						r = "value";
						break;
					case "importRule-begin":
						r = "importRule";
						break;
				}
				break;
			case "/":
				e.charAt(n + 1) === "*" ? (n += 2, i = e.indexOf("*/", n), i === -1 ? T("Missing */") : n = i + 1) : a += E, r === "importRule-begin" && (a += " ", r = "importRule");
				break;
			case "@":
				if (e.indexOf("@-moz-document", n) === n) {
					r = "documentRule-begin", S = new t.CSSDocumentRule(), S.__starts = n, n += 13, a = "";
					break;
				} else if (e.indexOf("@media", n) === n) {
					r = "atBlock", _ = new t.CSSMediaRule(), _.__starts = n, n += 5, a = "";
					break;
				} else if (e.indexOf("@supports", n) === n) {
					r = "conditionBlock", v = new t.CSSSupportsRule(), v.__starts = n, n += 8, a = "";
					break;
				} else if (e.indexOf("@host", n) === n) {
					r = "hostRule-begin", n += 4, C = new t.CSSHostRule(), C.__starts = n, a = "";
					break;
				} else if (e.indexOf("@import", n) === n) {
					r = "importRule-begin", n += 6, a += "@import";
					break;
				} else if (e.indexOf("@font-face", n) === n) {
					r = "fontFaceRule-begin", n += 9, b = new t.CSSFontFaceRule(), b.__starts = n, a = "";
					break;
				} else {
					w.lastIndex = n;
					var D = w.exec(e);
					if (D && D.index === n) {
						r = "keyframesRule-begin", x = new t.CSSKeyframesRule(), x.__starts = n, x._vendorPrefix = D[1], n += D[0].length - 1, a = "";
						break;
					} else r === "selector" && (r = "atRule");
				}
				a += E;
				break;
			case "{":
				r === "selector" || r === "atRule" ? (g.selectorText = a.trim(), g.style.__starts = n, a = "", r = "before-name") : r === "atBlock" ? (_.media.mediaText = a.trim(), u && d.push(u), l = u = _, _.parentStyleSheet = c, a = "", r = "before-selector") : r === "conditionBlock" ? (v.conditionText = a.trim(), u && d.push(u), l = u = v, v.parentStyleSheet = c, a = "", r = "before-selector") : r === "hostRule-begin" ? (u && d.push(u), l = u = C, C.parentStyleSheet = c, a = "", r = "before-selector") : r === "fontFaceRule-begin" ? (u && (b.parentRule = u), b.parentStyleSheet = c, g = b, a = "", r = "before-name") : r === "keyframesRule-begin" ? (x.name = a.trim(), u && (d.push(u), x.parentRule = u), x.parentStyleSheet = c, l = u = x, a = "", r = "keyframeRule-begin") : r === "keyframeRule-begin" ? (g = new t.CSSKeyframeRule(), g.keyText = a.trim(), g.__starts = n, a = "", r = "before-name") : r === "documentRule-begin" && (S.matcher.matcherText = a.trim(), u && (d.push(u), S.parentRule = u), l = u = S, S.parentStyleSheet = c, a = "", r = "before-selector");
				break;
			case ":":
				r === "name" ? (m = a.trim(), a = "", r = "before-value") : a += E;
				break;
			case "(":
				if (r === "value") if (a.trim() === "expression") {
					var O = new t.CSSValueExpression(e, n).parse();
					O.error ? T(O.error) : (a += O.expression, n = O.idx);
				} else r = "value-parenthesis", o = 1, a += E;
				else r === "value-parenthesis" && o++, a += E;
				break;
			case ")":
				r === "value-parenthesis" && (o--, o === 0 && (r = "value")), a += E;
				break;
			case "!":
				r === "value" && e.indexOf("!important", n) === n ? (h = "important", n += 9) : a += E;
				break;
			case ";":
				switch (r) {
					case "value":
						g.style.setProperty(m, a.trim(), h), h = "", a = "", r = "before-name";
						break;
					case "atRule":
						a = "", r = "before-selector";
						break;
					case "importRule":
						y = new t.CSSImportRule(), y.parentStyleSheet = y.styleSheet.parentStyleSheet = c, y.cssText = a + E, c.cssRules.push(y), a = "", r = "before-selector";
						break;
					default:
						a += E;
						break;
				}
				break;
			case "}":
				switch (r) {
					case "value": g.style.setProperty(m, a.trim(), h), h = "";
					case "before-name":
					case "name":
						g.__ends = n + 1, u && (g.parentRule = u), g.parentStyleSheet = c, l.cssRules.push(g), a = "", r = l.constructor === t.CSSKeyframesRule ? "keyframeRule-begin" : "before-selector";
						break;
					case "keyframeRule-begin":
					case "before-selector":
					case "selector":
						for (u || T("Unexpected }"), f = d.length > 0; d.length > 0;) {
							if (u = d.pop(), u.constructor.name === "CSSMediaRule" || u.constructor.name === "CSSSupportsRule") {
								p = l, l = u, l.cssRules.push(p);
								break;
							}
							d.length === 0 && (f = !1);
						}
						f || (l.__ends = n + 1, c.cssRules.push(l), l = c, u = null), a = "", r = "before-selector";
						break;
				}
				break;
			default:
				switch (r) {
					case "before-selector":
						r = "selector", g = new t.CSSStyleRule(), g.__starts = n;
						break;
					case "before-name":
						r = "name";
						break;
					case "before-value":
						r = "value";
						break;
					case "importRule-begin":
						r = "importRule";
						break;
				}
				a += E;
				break;
		}
		return c;
	}, e.parse = t.parse, t.CSSStyleSheet = du().CSSStyleSheet, t.CSSStyleRule = uu().CSSStyleRule, t.CSSImportRule = pu().CSSImportRule, t.CSSGroupingRule = mu().CSSGroupingRule, t.CSSMediaRule = gu().CSSMediaRule, t.CSSConditionRule = hu().CSSConditionRule, t.CSSSupportsRule = _u().CSSSupportsRule, t.CSSFontFaceRule = vu().CSSFontFaceRule, t.CSSHostRule = yu().CSSHostRule, t.CSSStyleDeclaration = Du().CSSStyleDeclaration, t.CSSKeyframeRule = bu().CSSKeyframeRule, t.CSSKeyframesRule = xu().CSSKeyframesRule, t.CSSValueExpression = Cu().CSSValueExpression, t.CSSDocumentRule = Tu().CSSDocumentRule;
})), Du = /* @__PURE__ */ s(((e) => {
	var t = {};
	t.CSSStyleDeclaration = function() {
		this.length = 0, this.parentRule = null, this._importants = {};
	}, t.CSSStyleDeclaration.prototype = {
		constructor: t.CSSStyleDeclaration,
		getPropertyValue: function(e) {
			return this[e] || "";
		},
		setProperty: function(e, t, n) {
			this[e] ? Array.prototype.indexOf.call(this, e) < 0 && (this[this.length] = e, this.length++) : (this[this.length] = e, this.length++), this[e] = t + "", this._importants[e] = n;
		},
		removeProperty: function(e) {
			if (!(e in this)) return "";
			var t = Array.prototype.indexOf.call(this, e);
			if (t < 0) return "";
			var n = this[e];
			return this[e] = "", Array.prototype.splice.call(this, t, 1), n;
		},
		getPropertyCSSValue: function() {},
		getPropertyPriority: function(e) {
			return this._importants[e] || "";
		},
		getPropertyShorthand: function() {},
		isPropertyImplicit: function() {},
		get cssText() {
			for (var e = [], t = 0, n = this.length; t < n; ++t) {
				var r = this[t], i = this.getPropertyValue(r), a = this.getPropertyPriority(r);
				a && (a = " !" + a), e[t] = r + ": " + i + a + ";";
			}
			return e.join(" ");
		},
		set cssText(e) {
			var n, r;
			for (n = this.length; n--;) r = this[n], this[r] = "";
			Array.prototype.splice.call(this, 0, this.length), this._importants = {};
			var i = t.parse("#bogus{" + e + "}").cssRules[0].style, a = i.length;
			for (n = 0; n < a; ++n) r = i[n], this.setProperty(i[n], i.getPropertyValue(r), i.getPropertyPriority(r));
		}
	}, e.CSSStyleDeclaration = t.CSSStyleDeclaration, t.parse = Eu().parse;
})), Ou = /* @__PURE__ */ s(((e) => {
	var t = {
		CSSStyleSheet: du().CSSStyleSheet,
		CSSRule: lu().CSSRule,
		CSSStyleRule: uu().CSSStyleRule,
		CSSGroupingRule: mu().CSSGroupingRule,
		CSSConditionRule: hu().CSSConditionRule,
		CSSMediaRule: gu().CSSMediaRule,
		CSSSupportsRule: _u().CSSSupportsRule,
		CSSStyleDeclaration: Du().CSSStyleDeclaration,
		CSSKeyframeRule: bu().CSSKeyframeRule,
		CSSKeyframesRule: xu().CSSKeyframesRule
	};
	t.clone = function e(n) {
		var r = new t.CSSStyleSheet(), i = n.cssRules;
		if (!i) return r;
		for (var a = 0, o = i.length; a < o; a++) {
			var s = i[a], c = r.cssRules[a] = new s.constructor(), l = s.style;
			if (l) {
				for (var u = c.style = new t.CSSStyleDeclaration(), d = 0, f = l.length; d < f; d++) {
					var p = u[d] = l[d];
					u[p] = l[p], u._importants[p] = l.getPropertyPriority(p);
				}
				u.length = l.length;
			}
			s.hasOwnProperty("keyText") && (c.keyText = s.keyText), s.hasOwnProperty("selectorText") && (c.selectorText = s.selectorText), s.hasOwnProperty("mediaText") && (c.mediaText = s.mediaText), s.hasOwnProperty("conditionText") && (c.conditionText = s.conditionText), s.hasOwnProperty("cssRules") && (c.cssRules = e(s).cssRules);
		}
		return r;
	}, e.clone = t.clone;
})), ku = (/* @__PURE__ */ s(((e) => {
	e.CSSStyleDeclaration = Du().CSSStyleDeclaration, e.CSSRule = lu().CSSRule, e.CSSGroupingRule = mu().CSSGroupingRule, e.CSSConditionRule = hu().CSSConditionRule, e.CSSStyleRule = uu().CSSStyleRule, e.MediaList = fu().MediaList, e.CSSMediaRule = gu().CSSMediaRule, e.CSSSupportsRule = _u().CSSSupportsRule, e.CSSImportRule = pu().CSSImportRule, e.CSSFontFaceRule = vu().CSSFontFaceRule, e.CSSHostRule = yu().CSSHostRule, e.StyleSheet = cu().StyleSheet, e.CSSStyleSheet = du().CSSStyleSheet, e.CSSKeyframesRule = xu().CSSKeyframesRule, e.CSSKeyframeRule = bu().CSSKeyframeRule, e.MatcherList = wu().MatcherList, e.CSSDocumentRule = Tu().CSSDocumentRule, e.CSSValue = Su().CSSValue, e.CSSValueExpression = Cu().CSSValueExpression, e.parse = Eu().parse, e.clone = Ou().clone;
})))(), Au = "style", ju = class extends $l {
	constructor(e, t = Au) {
		super(e, t), this[sn] = null;
	}
	get sheet() {
		let e = this[sn];
		return e === null ? this[sn] = (0, ku.parse)(this.textContent) : e;
	}
	get innerHTML() {
		return super.innerHTML || "";
	}
	set innerHTML(e) {
		super.textContent = e, this[sn] = null;
	}
	get innerText() {
		return super.innerText || "";
	}
	set innerText(e) {
		super.textContent = e, this[sn] = null;
	}
	get textContent() {
		return super.textContent || "";
	}
	set textContent(e) {
		super.textContent = e, this[sn] = null;
	}
};
ja(Au, ju);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/time-element.js
var Mu = class extends $ {
	constructor(e, t = "time") {
		super(e, t);
	}
	get dateTime() {
		return Y.get(this, "datetime");
	}
	set dateTime(e) {
		Y.set(this, "datetime", e);
	}
};
ja("time", Mu);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/field-set-element.js
var Nu = class extends $ {
	constructor(e, t = "fieldset") {
		super(e, t);
	}
}, Pu = class extends $ {
	constructor(e, t = "embed") {
		super(e, t);
	}
}, Fu = class extends $ {
	constructor(e, t = "hr") {
		super(e, t);
	}
}, Iu = class extends $ {
	constructor(e, t = "progress") {
		super(e, t);
	}
}, Lu = class extends $ {
	constructor(e, t = "p") {
		super(e, t);
	}
}, Ru = class extends $ {
	constructor(e, t = "table") {
		super(e, t);
	}
}, zu = class extends $ {
	constructor(e, t = "frameset") {
		super(e, t);
	}
}, Bu = class extends $ {
	constructor(e, t = "li") {
		super(e, t);
	}
}, Vu = class extends $ {
	constructor(e, t = "base") {
		super(e, t);
	}
}, Hu = class extends $ {
	constructor(e, t = "datalist") {
		super(e, t);
	}
}, Uu = "input", Wu = class extends $ {
	constructor(e, t = Uu) {
		super(e, t);
	}
	/* c8 ignore start */
	get autofocus() {
		return Ka.get(this, "autofocus") || -1;
	}
	set autofocus(e) {
		Ka.set(this, "autofocus", e);
	}
	get disabled() {
		return Ka.get(this, "disabled");
	}
	set disabled(e) {
		Ka.set(this, "disabled", e);
	}
	get name() {
		return this.getAttribute("name");
	}
	set name(e) {
		this.setAttribute("name", e);
	}
	get placeholder() {
		return this.getAttribute("placeholder");
	}
	set placeholder(e) {
		this.setAttribute("placeholder", e);
	}
	get type() {
		return this.getAttribute("type");
	}
	set type(e) {
		this.setAttribute("type", e);
	}
	get value() {
		return Y.get(this, "value");
	}
	set value(e) {
		Y.set(this, "value", e);
	}
};
ja(Uu, Wu);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/param-element.js
var Gu = class extends $ {
	constructor(e, t = "param") {
		super(e, t);
	}
}, Ku = class extends $ {
	constructor(e, t = "media") {
		super(e, t);
	}
}, qu = class extends $ {
	constructor(e, t = "audio") {
		super(e, t);
	}
}, Ju = "h1", Yu = class extends $ {
	constructor(e, t = Ju) {
		super(e, t);
	}
};
ja([
	Ju,
	"h2",
	"h3",
	"h4",
	"h5",
	"h6"
], Yu);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/directory-element.js
var Xu = class extends $ {
	constructor(e, t = "dir") {
		super(e, t);
	}
}, Zu = class extends $ {
	constructor(e, t = "quote") {
		super(e, t);
	}
}, Qu = /* @__PURE__ */ c({ default: () => $u }), $u, ed = o((() => {
	throw $u = {}, Error("Could not resolve \"canvas\" imported by \"linkedom\". Is it installed?");
})), td = /* @__PURE__ */ s(((e, t) => {
	var n = class {
		constructor(e, t) {
			this.width = e, this.height = t;
		}
		getContext() {
			return null;
		}
		toDataURL() {
			return "";
		}
	};
	t.exports = { createCanvas: (e, t) => new n(e, t) };
})), { createCanvas: nd } = (/* @__PURE__ */ u((/* @__PURE__ */ s(((e, t) => {
	/* c8 ignore start */
	try {
		t.exports = (ed(), d(Qu));
	} catch {
		t.exports = td();
	}
})))(), 1)).default, rd = "canvas", id = class extends $ {
	constructor(e, t = rd) {
		super(e, t), this[en] = nd(300, 150);
	}
	get width() {
		return this[en].width;
	}
	set width(e) {
		qa.set(this, "width", e), this[en].width = e;
	}
	get height() {
		return this[en].height;
	}
	set height(e) {
		qa.set(this, "height", e), this[en].height = e;
	}
	getContext(e) {
		return this[en].getContext(e);
	}
	toDataURL(...e) {
		return this[en].toDataURL(...e);
	}
};
ja(rd, id);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/legend-element.js
var ad = class extends $ {
	constructor(e, t = "legend") {
		super(e, t);
	}
}, od = "option", sd = class extends $ {
	constructor(e, t = od) {
		super(e, t);
	}
	/* c8 ignore start */
	get value() {
		return Y.get(this, "value");
	}
	set value(e) {
		Y.set(this, "value", e);
	}
	/* c8 ignore stop */
	get selected() {
		return Ka.get(this, "selected");
	}
	set selected(e) {
		var t;
		let n = (t = this.parentElement) == null ? void 0 : t.querySelector("option[selected]");
		n && n !== this && (n.selected = !1), Ka.set(this, "selected", e);
	}
};
ja(od, sd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/span-element.js
var cd = class extends $ {
	constructor(e, t = "span") {
		super(e, t);
	}
}, ld = class extends $ {
	constructor(e, t = "meter") {
		super(e, t);
	}
}, ud = class extends $ {
	constructor(e, t = "video") {
		super(e, t);
	}
}, dd = class extends $ {
	constructor(e, t = "td") {
		super(e, t);
	}
}, fd = "title", pd = class extends $l {
	constructor(e, t = fd) {
		super(e, t);
	}
};
ja(fd, pd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/output-element.js
var md = class extends $ {
	constructor(e, t = "output") {
		super(e, t);
	}
}, hd = class extends $ {
	constructor(e, t = "tr") {
		super(e, t);
	}
}, gd = class extends $ {
	constructor(e, t = "data") {
		super(e, t);
	}
}, _d = class extends $ {
	constructor(e, t = "menu") {
		super(e, t);
	}
}, vd = "select", yd = class extends $ {
	constructor(e, t = vd) {
		super(e, t);
	}
	get options() {
		let e = new Qa(), { firstElementChild: t } = this;
		for (; t;) t.tagName === "OPTGROUP" ? e.push(...t.children) : e.push(t), t = t.nextElementSibling;
		return e;
	}
	/* c8 ignore start */
	get disabled() {
		return Ka.get(this, "disabled");
	}
	set disabled(e) {
		Ka.set(this, "disabled", e);
	}
	get name() {
		return this.getAttribute("name");
	}
	set name(e) {
		this.setAttribute("name", e);
	}
	/* c8 ignore stop */
	get value() {
		var e;
		return (e = this.querySelector("option[selected]")) == null ? void 0 : e.value;
	}
};
ja(vd, yd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/br-element.js
var bd = class extends $ {
	constructor(e, t = "br") {
		super(e, t);
	}
}, xd = "button", Sd = class extends $ {
	constructor(e, t = xd) {
		super(e, t);
	}
	/* c8 ignore start */
	get disabled() {
		return Ka.get(this, "disabled");
	}
	set disabled(e) {
		Ka.set(this, "disabled", e);
	}
	get name() {
		return this.getAttribute("name");
	}
	set name(e) {
		this.setAttribute("name", e);
	}
	get type() {
		return this.getAttribute("type");
	}
	set type(e) {
		this.setAttribute("type", e);
	}
};
ja(xd, Sd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/map-element.js
var Cd = class extends $ {
	constructor(e, t = "map") {
		super(e, t);
	}
}, wd = class extends $ {
	constructor(e, t = "optgroup") {
		super(e, t);
	}
}, Td = class extends $ {
	constructor(e, t = "dl") {
		super(e, t);
	}
}, Ed = "textarea", Dd = class extends $l {
	constructor(e, t = Ed) {
		super(e, t);
	}
	/* c8 ignore start */
	get disabled() {
		return Ka.get(this, "disabled");
	}
	set disabled(e) {
		Ka.set(this, "disabled", e);
	}
	get name() {
		return this.getAttribute("name");
	}
	set name(e) {
		this.setAttribute("name", e);
	}
	get placeholder() {
		return this.getAttribute("placeholder");
	}
	set placeholder(e) {
		this.setAttribute("placeholder", e);
	}
	get type() {
		return this.getAttribute("type");
	}
	set type(e) {
		this.setAttribute("type", e);
	}
	get value() {
		return this.textContent;
	}
	set value(e) {
		this.textContent = e;
	}
};
ja(Ed, Dd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/font-element.js
var Od = class extends $ {
	constructor(e, t = "font") {
		super(e, t);
	}
}, kd = class extends $ {
	constructor(e, t = "div") {
		super(e, t);
	}
}, Ad = "link", jd = class extends $ {
	constructor(e, t = Ad) {
		super(e, t);
	}
	/* c8 ignore start */ get disabled() {
		return Ka.get(this, "disabled");
	}
	set disabled(e) {
		Ka.set(this, "disabled", e);
	}
	get href() {
		return Y.get(this, "href").trim();
	}
	set href(e) {
		Y.set(this, "href", e);
	}
	get hreflang() {
		return Y.get(this, "hreflang");
	}
	set hreflang(e) {
		Y.set(this, "hreflang", e);
	}
	get media() {
		return Y.get(this, "media");
	}
	set media(e) {
		Y.set(this, "media", e);
	}
	get rel() {
		return Y.get(this, "rel");
	}
	set rel(e) {
		Y.set(this, "rel", e);
	}
	get type() {
		return Y.get(this, "type");
	}
	set type(e) {
		Y.set(this, "type", e);
	}
};
ja(Ad, jd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/slot-element.js
var Md = "slot", Nd = class extends $ {
	constructor(e, t = Md) {
		super(e, t);
	}
	/* c8 ignore start */
	get name() {
		return this.getAttribute("name");
	}
	set name(e) {
		this.setAttribute("name", e);
	}
	assign() {}
	assignedNodes(e) {
		var t, n;
		let r = !!this.name, i = (t = (n = this.getRootNode().host) == null ? void 0 : n.childNodes) == null ? [] : t, a;
		if (a = r ? [...i].filter((e) => e.slot === this.name) : [...i].filter((e) => !e.slot), e != null && e.flatten) {
			let e = [];
			for (let t of a) t.localName === "slot" ? e.push(...t.assignedNodes({ flatten: !0 })) : e.push(t);
			a = e;
		}
		return a.length ? a : [...this.childNodes];
	}
	assignedElements(e) {
		let t = this.assignedNodes(e).filter((e) => e.nodeType === 1);
		return t.length ? t : [...this.children];
	}
};
ja(Md, Nd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/form-element.js
var Pd = class extends $ {
	constructor(e, t = "form") {
		super(e, t);
	}
}, Fd = "img", Id = class extends $ {
	constructor(e, t = Fd) {
		super(e, t);
	}
	/* c8 ignore start */
	get alt() {
		return Y.get(this, "alt");
	}
	set alt(e) {
		Y.set(this, "alt", e);
	}
	get sizes() {
		return Y.get(this, "sizes");
	}
	set sizes(e) {
		Y.set(this, "sizes", e);
	}
	get src() {
		return Y.get(this, "src");
	}
	set src(e) {
		Y.set(this, "src", e);
	}
	get srcset() {
		return Y.get(this, "srcset");
	}
	set srcset(e) {
		Y.set(this, "srcset", e);
	}
	get title() {
		return Y.get(this, "title");
	}
	set title(e) {
		Y.set(this, "title", e);
	}
	get width() {
		return qa.get(this, "width");
	}
	set width(e) {
		qa.set(this, "width", e);
	}
	get height() {
		return qa.get(this, "height");
	}
	set height(e) {
		qa.set(this, "height", e);
	}
};
ja(Fd, Id);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/pre-element.js
var Ld = class extends $ {
	constructor(e, t = "pre") {
		super(e, t);
	}
}, Rd = class extends $ {
	constructor(e, t = "ul") {
		super(e, t);
	}
}, zd = "meta", Bd = class extends $ {
	constructor(e, t = zd) {
		super(e, t);
	}
	/* c8 ignore start */
	get name() {
		return Y.get(this, "name");
	}
	set name(e) {
		Y.set(this, "name", e);
	}
	get httpEquiv() {
		return Y.get(this, "http-equiv");
	}
	set httpEquiv(e) {
		Y.set(this, "http-equiv", e);
	}
	get content() {
		return Y.get(this, "content");
	}
	set content(e) {
		Y.set(this, "content", e);
	}
	get charset() {
		return Y.get(this, "charset");
	}
	set charset(e) {
		Y.set(this, "charset", e);
	}
	get media() {
		return Y.get(this, "media");
	}
	set media(e) {
		Y.set(this, "media", e);
	}
};
ja(zd, Bd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/picture-element.js
var Vd = class extends $ {
	constructor(e, t = "picture") {
		super(e, t);
	}
}, Hd = class extends $ {
	constructor(e, t = "area") {
		super(e, t);
	}
}, Ud = class extends $ {
	constructor(e, t = "ol") {
		super(e, t);
	}
}, Wd = class extends $ {
	constructor(e, t = "caption") {
		super(e, t);
	}
}, Gd = "a", Kd = class extends $ {
	constructor(e, t = Gd) {
		super(e, t);
	}
	/* c8 ignore start */ get href() {
		return encodeURI(decodeURI(Y.get(this, "href"))).trim();
	}
	set href(e) {
		Y.set(this, "href", decodeURI(e));
	}
	get download() {
		return encodeURI(decodeURI(Y.get(this, "download")));
	}
	set download(e) {
		Y.set(this, "download", decodeURI(e));
	}
	get target() {
		return Y.get(this, "target");
	}
	set target(e) {
		Y.set(this, "target", e);
	}
	get type() {
		return Y.get(this, "type");
	}
	set type(e) {
		Y.set(this, "type", e);
	}
	get rel() {
		return Y.get(this, "rel");
	}
	set rel(e) {
		Y.set(this, "rel", e);
	}
};
ja(Gd, Kd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/label-element.js
var qd = class extends $ {
	constructor(e, t = "label") {
		super(e, t);
	}
}, Jd = class extends $ {
	constructor(e, t = "unknown") {
		super(e, t);
	}
}, Yd = class extends $ {
	constructor(e, t = "mod") {
		super(e, t);
	}
}, Xd = class extends $ {
	constructor(e, t = "details") {
		super(e, t);
	}
}, Zd = "source", Qd = class extends $ {
	constructor(e, t = Zd) {
		super(e, t);
	}
	/* c8 ignore start */
	get src() {
		return Y.get(this, "src");
	}
	set src(e) {
		Y.set(this, "src", e);
	}
	get srcset() {
		return Y.get(this, "srcset");
	}
	set srcset(e) {
		Y.set(this, "srcset", e);
	}
	get sizes() {
		return Y.get(this, "sizes");
	}
	set sizes(e) {
		Y.set(this, "sizes", e);
	}
	get type() {
		return Y.get(this, "type");
	}
	set type(e) {
		Y.set(this, "type", e);
	}
};
ja(Zd, Qd);
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/shared/html-classes.js
var $d = {
	HTMLElement: $,
	HTMLTemplateElement: Xl,
	HTMLHtmlElement: Zl,
	HTMLScriptElement: tu,
	HTMLFrameElement: nu,
	HTMLIFrameElement: iu,
	HTMLObjectElement: au,
	HTMLHeadElement: ou,
	HTMLBodyElement: su,
	HTMLStyleElement: ju,
	HTMLTimeElement: Mu,
	HTMLFieldSetElement: Nu,
	HTMLEmbedElement: Pu,
	HTMLHRElement: Fu,
	HTMLProgressElement: Iu,
	HTMLParagraphElement: Lu,
	HTMLTableElement: Ru,
	HTMLFrameSetElement: zu,
	HTMLLIElement: Bu,
	HTMLBaseElement: Vu,
	HTMLDataListElement: Hu,
	HTMLInputElement: Wu,
	HTMLParamElement: Gu,
	HTMLMediaElement: Ku,
	HTMLAudioElement: qu,
	HTMLHeadingElement: Yu,
	HTMLDirectoryElement: Xu,
	HTMLQuoteElement: Zu,
	HTMLCanvasElement: id,
	HTMLLegendElement: ad,
	HTMLOptionElement: sd,
	HTMLSpanElement: cd,
	HTMLMeterElement: ld,
	HTMLVideoElement: ud,
	HTMLTableCellElement: dd,
	HTMLTitleElement: pd,
	HTMLOutputElement: md,
	HTMLTableRowElement: hd,
	HTMLDataElement: gd,
	HTMLMenuElement: _d,
	HTMLSelectElement: yd,
	HTMLBRElement: bd,
	HTMLButtonElement: Sd,
	HTMLMapElement: Cd,
	HTMLOptGroupElement: wd,
	HTMLDListElement: Td,
	HTMLTextAreaElement: Dd,
	HTMLFontElement: Od,
	HTMLDivElement: kd,
	HTMLLinkElement: jd,
	HTMLSlotElement: Nd,
	HTMLFormElement: Pd,
	HTMLImageElement: Id,
	HTMLPreElement: Ld,
	HTMLUListElement: Rd,
	HTMLMetaElement: Bd,
	HTMLPictureElement: Vd,
	HTMLAreaElement: Hd,
	HTMLOListElement: Ud,
	HTMLTableCaptionElement: Wd,
	HTMLAnchorElement: Kd,
	HTMLLabelElement: qd,
	HTMLUnknownElement: Jd,
	HTMLModElement: Yd,
	HTMLDetailsElement: Xd,
	HTMLSourceElement: Qd,
	HTMLTrackElement: class extends $ {
		constructor(e, t = "track") {
			super(e, t);
		}
	},
	HTMLMarqueeElement: class extends $ {
		constructor(e, t = "marquee") {
			super(e, t);
		}
	}
}, ef = { test: () => !0 }, tf = {
	"text/html": {
		docType: "<!DOCTYPE html>",
		ignoreCase: !0,
		voidElements: /^(?:area|base|br|col|embed|hr|img|input|keygen|link|menuitem|meta|param|source|track|wbr)$/i
	},
	"image/svg+xml": {
		docType: "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
		ignoreCase: !1,
		voidElements: ef
	},
	"text/xml": {
		docType: "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
		ignoreCase: !1,
		voidElements: ef
	},
	"application/xml": {
		docType: "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
		ignoreCase: !1,
		voidElements: ef
	},
	"application/xhtml+xml": {
		docType: "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
		ignoreCase: !1,
		voidElements: ef
	}
}, nf = class extends Tl {
	constructor(e, t = {}) {
		super(e, t), this.detail = t.detail;
	}
}, rf = class extends Tl {
	constructor(e, t = {}) {
		super(e, t), this.inputType = t.inputType, this.data = t.data, this.dataTransfer = t.dataTransfer, this.isComposing = t.isComposing || !1, this.ranges = t.ranges;
	}
}, af = (e) => class extends Id {
	constructor(t, n) {
		switch (super(e), arguments.length) {
			case 1:
				this.height = t, this.width = t;
				break;
			case 2:
				this.height = n, this.width = t;
				break;
		}
	}
}, of = ({ [cn]: e, [W]: t }, n = null) => {
	pa(e[an], t[G]);
	do {
		let r = oa(e), i = r === t ? r : r[G];
		n ? n.insertBefore(e, n[W]) : e.remove(), e = i;
	} while (e !== t);
}, sf = class e {
	constructor() {
		this[cn] = null, this[W] = null, this.commonAncestorContainer = null;
	}
	insertNode(e) {
		this[W].parentNode.insertBefore(e, this[cn]);
	}
	selectNode(e) {
		this[cn] = e, this[W] = oa(e);
	}
	selectNodeContents(e) {
		this.selectNode(e), this.commonAncestorContainer = e;
	}
	surroundContents(e) {
		e.replaceChildren(this.extractContents());
	}
	setStartBefore(e) {
		this[cn] = e;
	}
	setStartAfter(e) {
		this[cn] = e.nextSibling;
	}
	setEndBefore(e) {
		this[W] = oa(e.previousSibling);
	}
	setEndAfter(e) {
		this[W] = oa(e);
	}
	cloneContents() {
		let { [cn]: e, [W]: t } = this, n = e.ownerDocument.createDocumentFragment();
		for (; e !== t;) n.insertBefore(e.cloneNode(!0), n[W]), e = oa(e), e !== t && (e = e[G]);
		return n;
	}
	deleteContents() {
		of(this);
	}
	extractContents() {
		let e = this[cn].ownerDocument.createDocumentFragment();
		return of(this, e), e;
	}
	createContextualFragment(e) {
		let { commonAncestorContainer: t } = this, n = "ownerSVGElement" in t, r = n ? t.ownerDocument : t, i = ma(r, e);
		if (n) {
			let e = [...i.childNodes];
			i = r.createDocumentFragment(), Object.setPrototypeOf(i, Pl.prototype), i.ownerSVGElement = r;
			for (let t of e) Object.setPrototypeOf(t, Pl.prototype), t.ownerSVGElement = r, i.appendChild(t);
		} else this.selectNode(i);
		return i;
	}
	cloneRange() {
		let t = new e();
		return t[cn] = this[cn], t[W] = this[W], t;
	}
}, cf = ({ nodeType: e }, t) => {
	switch (e) {
		case 1: return t & 1;
		case 3: return t & 4;
		case 8: return t & 128;
		case 4: return t & 8;
	}
	return 0;
}, lf = class {
	constructor(e, t = -1) {
		this.root = e, this.currentNode = e, this.whatToShow = t;
		let { [G]: n, [W]: r } = e;
		if (e.nodeType === 9) {
			let { documentElement: t } = e;
			n = t, r = t[W];
		}
		let i = [];
		for (; n && n !== r;) cf(n, t) && i.push(n), n = n[G];
		this[on] = {
			i: 0,
			nodes: i
		};
	}
	nextNode() {
		let e = this[on];
		return this.currentNode = e.i < e.nodes.length ? e.nodes[e.i++] : null, this.currentNode;
	}
}, uf = (e, t, n) => {
	let { [G]: r, [W]: i } = t;
	return e.call({
		ownerDocument: t,
		[G]: r,
		[W]: i
	}, n);
}, df = Qi({}, ql, $d, {
	CustomEvent: nf,
	Event: Tl,
	EventTarget: Za,
	InputEvent: rf,
	NamedNodeMap: El,
	NodeList: Qa
}), ff = /* @__PURE__ */ new WeakMap(), pf = class extends Zc {
	constructor(e) {
		super(null, "#document", 9), this[qt] = {
			active: !1,
			registry: null
		}, this[nn] = {
			active: !1,
			class: null
		}, this[tn] = tf[e], this[Xt] = null, this[Zt] = null, this[$t] = null, this[en] = null, this[un] = null;
	}
	get defaultView() {
		return ff.has(this) || ff.set(this, new Proxy(globalThis, {
			set: (e, t, n) => {
				switch (t) {
					case "addEventListener":
					case "removeEventListener":
					case "dispatchEvent":
						this[Qt][t] = n;
						break;
					default:
						e[t] = n;
						break;
				}
				return !0;
			},
			get: (e, t) => {
				switch (t) {
					case "addEventListener":
					case "removeEventListener":
					case "dispatchEvent":
						if (!this[Qt]) {
							let e = this[Qt] = new Za();
							e.dispatchEvent = e.dispatchEvent.bind(e), e.addEventListener = e.addEventListener.bind(e), e.removeEventListener = e.removeEventListener.bind(e);
						}
						return this[Qt][t];
					case "document": return this;
					/* c8 ignore start */
					case "navigator": return { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36" };
					/* c8 ignore stop */
					case "window": return ff.get(this);
					case "customElements": return this[qt].registry || (this[qt] = new Ta(this)), this[qt];
					case "performance": return e.performance;
					case "DOMParser": return this[Zt];
					case "Image": return this[en] || (this[en] = af(this)), this[en];
					case "MutationObserver": return this[nn].class || (this[nn] = new Ha(this)), this[nn].class;
				}
				return this[$t] && this[$t][t] || df[t] || e[t];
			}
		})), ff.get(this);
	}
	get doctype() {
		let e = this[Xt];
		if (e) return e;
		let { firstChild: t } = this;
		return t && t.nodeType === 10 ? this[Xt] = t : null;
	}
	set doctype(e) {
		if (/^([a-z:]+)(\s+system|\s+public(\s+"([^"]+)")?)?(\s+"([^"]+)")?/i.test(e)) {
			let { $1: e, $4: t, $6: n } = RegExp;
			this[Xt] = new $c(this, e, t, n), da(this, this[Xt], this[G]);
		}
	}
	get documentElement() {
		return this.firstElementChild;
	}
	get isConnected() {
		return !0;
	}
	_getParent() {
		return this[Qt];
	}
	createAttribute(e) {
		return new so(this, e);
	}
	createCDATASection(e) {
		return new xo(this, e);
	}
	createComment(e) {
		return new So(this, e);
	}
	createDocumentFragment() {
		return new Qc(this);
	}
	createDocumentType(e, t, n) {
		return new $c(this, e, t, n);
	}
	createElement(e) {
		return new jl(this, e);
	}
	createRange() {
		let e = new sf();
		return e.commonAncestorContainer = this, e;
	}
	createTextNode(e) {
		return new qc(this, e);
	}
	createTreeWalker(e, t = -1) {
		return new lf(e, t);
	}
	createNodeIterator(e, t = -1) {
		return this.createTreeWalker(e, t);
	}
	createEvent(e) {
		let t = $i(e === "Event" ? new Tl("") : new nf(""));
		return t.initEvent = t.initCustomEvent = (e, n = !1, r = !1, i) => {
			t.bubbles = !!n, ea(t, {
				type: { value: e },
				canBubble: { value: n },
				cancelable: { value: r },
				detail: { value: i }
			});
		}, t;
	}
	cloneNode(e = !1) {
		let { constructor: t, [qt]: n, [Xt]: r } = this, i = new t();
		if (i[qt] = n, e) {
			let e = i[W], { childNodes: t } = this;
			for (let { length: n } = t, r = 0; r < n; r++) i.insertBefore(t[r].cloneNode(!0), e);
			r && (i[Xt] = t[0]);
		}
		return i;
	}
	importNode(e) {
		let t = 1 < arguments.length && !!arguments[1], n = e.cloneNode(t), { [qt]: r } = this, { active: i } = r, a = (e) => {
			let { ownerDocument: t, nodeType: n } = e;
			e.ownerDocument = this, i && t !== this && n === 1 && r.upgrade(e);
		};
		if (a(n), t) switch (n.nodeType) {
			case 1:
			case 11: {
				let { [G]: e, [W]: t } = n;
				for (; e !== t;) e.nodeType === 1 && a(e), e = e[G];
				break;
			}
		}
		return n;
	}
	toString() {
		return this.childNodes.join("");
	}
	querySelector(e) {
		return uf(super.querySelector, this, e);
	}
	querySelectorAll(e) {
		return uf(super.querySelectorAll, this, e);
	}
	/* c8 ignore start */
	getElementsByTagNameNS(e, t) {
		return this.getElementsByTagName(t);
	}
	createAttributeNS(e, t) {
		return this.createAttribute(t);
	}
	createElementNS(e, t, n) {
		return e === "http://www.w3.org/2000/svg" ? new Pl(this, t, null) : this.createElement(t, n);
	}
};
ia(df.Document = function() {
	Fl();
}, pf).prototype = pf.prototype;
//#endregion
//#region node_modules/.pnpm/linkedom@0.18.12/node_modules/linkedom/esm/html/document.js
var mf = (e, t, n, r) => {
	if (!t && Aa.has(n)) return new (Aa.get(n))(e, n);
	let { [qt]: { active: i, registry: a } } = e;
	if (i) {
		let i = t ? r.is : n;
		if (a.has(i)) {
			let { Class: t } = a.get(i), r = new t(e, n);
			return va.set(r, { connected: !1 }), r;
		}
	}
	return new $(e, n);
}, hf = class extends pf {
	constructor() {
		super("text/html");
	}
	get all() {
		let e = new Qa(), { [G]: t, [W]: n } = this;
		for (; t !== n;) {
			switch (t.nodeType) {
				case 1:
					e.push(t);
					break;
			}
			t = t[G];
		}
		return e;
	}
	get head() {
		let { documentElement: e } = this, { firstElementChild: t } = e;
		return (!t || t.tagName !== "HEAD") && (t = this.createElement("head"), e.prepend(t)), t;
	}
	get body() {
		let { head: e } = this, { nextElementSibling: t } = e;
		return (!t || t.tagName !== "BODY") && (t = this.createElement("body"), e.after(t)), t;
	}
	get title() {
		var e;
		let { head: t } = this;
		return ((e = t.getElementsByTagName("title").at(0)) == null ? void 0 : e.textContent) || "";
	}
	set title(e) {
		let { head: t } = this, n = t.getElementsByTagName("title").at(0);
		n ? n.textContent = e : t.insertBefore(this.createElement("title"), t.firstChild).textContent = e;
	}
	createElement(e, t) {
		let n = !!(t && t.is), r = mf(this, n, e, t);
		return n && r.setAttribute("is", t.is), r;
	}
}, gf = class extends pf {
	constructor() {
		super("image/svg+xml");
	}
	toString() {
		return this[tn].docType + super.toString();
	}
}, _f = class extends pf {
	constructor() {
		super("text/xml");
	}
	toString() {
		return this[tn].docType + super.toString();
	}
}, vf = class e {
	parseFromString(t, n, r = null) {
		let i = !1, a;
		return n === "text/html" ? (i = !0, a = new hf()) : a = n === "image/svg+xml" ? new gf() : new _f(), a[Zt] = e, r && (a[$t] = r), i && t === "..." && (t = "<!doctype html><html><head></head><body></body></html>"), t ? ka(a, i, t) : a;
	}
}, { parse: yf } = JSON, bf = (e, t = null) => new vf().parseFromString(e, "text/html", t).defaultView;
function xf() {
	Fl();
}
ia(xf, pf).prototype = pf.prototype;
//#endregion
//#region packages/core/src/renderers/wordDocx.worker.ts
var Sf = self, Cf = function() {
	let e = this.childNodes;
	if (!e) return null;
	for (let t = 0; t < e.length; t += 1) {
		let n = typeof e.item == "function" ? e.item(t) : e[t];
		if ((n == null ? void 0 : n.nodeType) === 1) return n;
	}
	return null;
}, wf = (e) => {
	if (!e || typeof e != "object") return;
	let t = Object.getPrototypeOf(e);
	!t || Object.prototype.hasOwnProperty.call(t, "firstElementChild") || Object.defineProperty(t, "firstElementChild", {
		configurable: !0,
		get: Cf
	});
}, Tf = class extends Wt.DOMParser {
	parseFromString(e, t) {
		let n = super.parseFromString(e, t);
		return wf(n), wf(n.documentElement), n;
	}
}, Ef = (e, t) => t instanceof Error ? {
	id: e,
	ok: !1,
	message: t.message,
	stack: t.stack
} : {
	id: e,
	ok: !1,
	message: String(t)
}, Df = () => {
	let { window: e } = bf("<!doctype html><html><head></head><body></body></html>"), t = globalThis;
	return t.window = e, t.document = e.document, t.DOMParser = Tf, t.Node = e.Node, t.Element = e.Element, t.HTMLElement = e.HTMLElement, t.DocumentFragment = e.DocumentFragment, t.XMLSerializer = Wt.XMLSerializer, e.document;
}, Of = async (e) => {
	let t = Df(), n = t.createElement("div"), r = t.createElement("div");
	return t.body.append(n, r), await It(e.buffer, r, n, {
		...e.options,
		experimental: !1,
		useBase64URL: !0
	}), `${n.innerHTML}${r.innerHTML}`;
};
Sf.addEventListener("message", async (e) => {
	let t = e.data;
	try {
		let e = await Of(t);
		Sf.postMessage({
			id: t.id,
			ok: !0,
			html: e
		});
	} catch (e) {
		Sf.postMessage(Ef(t.id, e));
	}
});
//#endregion
