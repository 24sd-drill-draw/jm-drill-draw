// Rewrap a recorded clip into an ordinary MP4.
//
// Chrome records a STREAMING MP4: thousands of little moof/mdat fragments and
// no index at the front. VLC and Slack play that happily; WhatsApp, Clipchamp
// and iPhone Photos refuse it. The picture and sound are fine (H.264 + AAC) —
// only the wrapper is wrong — so every frame is copied across untouched into a
// normal MP4 with its index at the front. Nothing is re-encoded: no quality is
// lost and it takes seconds, not minutes.
//
// Two libraries, each doing the half it is good at:
//   mp4box.js  reads the fragments back out as samples
//   mp4-muxer  writes a plain, indexed MP4 (mp4box only writes fragments)
//
// Exposes: repackMp4(blob) -> Promise<Blob>. Any failure resolves to the
// ORIGINAL blob: a file that plays in Slack beats no file at all.
(function () {
  'use strict';

  function repackMp4(blob) {
    return new Promise(function (resolve) {
      var ok = blob && blob.size && typeof MP4Box !== 'undefined' &&
               typeof Mp4Muxer !== 'undefined' && String(blob.type).indexOf('mp4') >= 0;
      if (!ok) { resolve(blob); return; }

      var done = false;
      function give(b) { if (!done) { done = true; resolve(b && b.size ? b : blob); } }
      var guard = setTimeout(function () { give(blob); }, 40000);
      function fail() { clearTimeout(guard); give(blob); }

      try {
        var src = MP4Box.createFile();
        var target = new Mp4Muxer.ArrayBufferTarget();
        var muxer = null;
        var vId = 0, aId = 0, vTs = 1, aTs = 1;
        var wrote = 0;

        src.onError = fail;

        src.onReady = function (info) {
          try {
            var v = null, a = null;
            info.tracks.forEach(function (t) {
              if (!v && t.video) v = t;
              else if (!a && t.audio) a = t;
            });
            if (!v) return fail();
            vId = v.id; vTs = v.timescale || 1000;

            var opts = {
              target: target,
              // the whole point: the index goes at the front, where every
              // player and every phone looks for it
              fastStart: 'in-memory',
              firstTimestampBehavior: 'offset',
              video: {
                codec: 'avc',
                width: v.video ? v.video.width : v.track_width,
                height: v.video ? v.video.height : v.track_height
              }
            };
            if (a) {
              aId = a.id; aTs = a.timescale || 48000;
              opts.audio = {
                codec: 'aac',
                numberOfChannels: a.audio.channel_count || 2,
                sampleRate: a.audio.sample_rate || 48000
              };
            }
            muxer = new Mp4Muxer.Muxer(opts);

            info.tracks.forEach(function (t) {
              if (t.id === vId || t.id === aId) {
                src.setExtractionOptions(t.id, null, { nbSamples: 1000 });
              }
            });
            src.start();
          } catch (e) { fail(); }
        };

        src.onSamples = function (id, user, samples) {
          if (!muxer) return;
          try {
            for (var i = 0; i < samples.length; i++) {
              var s = samples[i];
              var tsBase = (id === vId) ? vTs : aTs;
              var us = Math.round(s.cts / tsBase * 1e6);        // microseconds
              var durUs = Math.round(s.duration / tsBase * 1e6);
              var meta = {};
              if (!wrote || (id === vId && s.is_sync)) {
                meta.decoderConfig = { description: descFor(src, id) };
              }
              if (id === vId) {
                muxer.addVideoChunkRaw(s.data, s.is_sync ? 'key' : 'delta', us, durUs, meta);
              } else if (id === aId) {
                muxer.addAudioChunkRaw(s.data, 'key', us, durUs, meta);
              }
              wrote++;
            }
          } catch (e) { fail(); }
        };

        blob.arrayBuffer().then(function (buf) {
          buf.fileStart = 0;
          src.appendBuffer(buf);
          src.flush();
          if (!wrote || !muxer) return fail();
          muxer.finalize();
          clearTimeout(guard);
          give(new Blob([target.buffer], { type: 'video/mp4' }));
        }).catch(fail);
      } catch (e) { fail(); }
    });
  }

  // The codec setup (avcC / esds contents), as the muxer wants it: raw bytes,
  // box header removed.
  var cache = {};
  function descFor(file, id) {
    if (cache[id]) return cache[id];
    try {
      var trak = file.getTrackById(id);
      var entry = trak.mdia.minf.stbl.stsd.entries[0];
      var box = entry.avcC || entry.hvcC || entry.esds;
      if (!box) return undefined;
      var s = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(s);
      cache[id] = new Uint8Array(s.buffer, 8);
      return cache[id];
    } catch (e) { return undefined; }
  }

  window.repackMp4 = repackMp4;
})();
