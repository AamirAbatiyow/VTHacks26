"""Decode MP3 to PCM WAV using an explicitly supplied local mpg123 library.

Fallback for machines without FFmpeg. Uses only Python's standard library.
"""
import argparse
import ctypes as C
import wave


def decode(source, output, library):
    lib = C.CDLL(library)
    signatures = {
        'mpg123_init': (C.c_int, []),
        'mpg123_new': (C.c_void_p, [C.c_char_p, C.POINTER(C.c_int)]),
        'mpg123_open': (C.c_int, [C.c_void_p, C.c_char_p]),
        'mpg123_getformat': (C.c_int, [C.c_void_p, C.POINTER(C.c_long), C.POINTER(C.c_int), C.POINTER(C.c_int)]),
        'mpg123_read': (C.c_int, [C.c_void_p, C.c_void_p, C.c_size_t, C.POINTER(C.c_size_t)]),
        'mpg123_close': (C.c_int, [C.c_void_p]),
        'mpg123_delete': (None, [C.c_void_p]),
        'mpg123_exit': (None, []),
    }
    for name, (result, args) in signatures.items():
        fn = getattr(lib, name)
        fn.restype, fn.argtypes = result, args
    if lib.mpg123_init() != 0:
        raise RuntimeError('mpg123 initialization failed')
    error = C.c_int()
    handle = lib.mpg123_new(None, C.byref(error))
    if not handle:
        raise RuntimeError(f'mpg123_new failed: {error.value}')
    try:
        if lib.mpg123_open(handle, str(source).encode()) != 0:
            raise RuntimeError('Could not open MP3')
        rate, channels, encoding = C.c_long(), C.c_int(), C.c_int()
        if lib.mpg123_getformat(handle, C.byref(rate), C.byref(channels), C.byref(encoding)) != 0:
            raise RuntimeError('Could not read MP3 format')
        if encoding.value != 0xd0:
            raise RuntimeError(f'Expected signed 16-bit PCM, received encoding {encoding.value}')
        with wave.open(str(output), 'wb') as wav:
            wav.setnchannels(channels.value)
            wav.setsampwidth(2)
            wav.setframerate(rate.value)
            buf = C.create_string_buffer(65536)
            count = C.c_size_t()
            while True:
                status = lib.mpg123_read(handle, buf, len(buf), C.byref(count))
                if count.value:
                    wav.writeframesraw(buf.raw[:count.value])
                if status == -12:  # MPG123_DONE
                    break
                if status != 0:
                    raise RuntimeError(f'MP3 decoding failed or changed format: {status}')
    finally:
        lib.mpg123_close(handle)
        lib.mpg123_delete(handle)
        lib.mpg123_exit()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--library', required=True)
    args = parser.parse_args()
    decode(args.audio, args.out, args.library)
