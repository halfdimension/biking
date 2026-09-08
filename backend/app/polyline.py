"""polyline6 decoding (Req 3.1, 3.2, 12.1).

Both routing engines emit geometry as **polyline6** (Google-polyline encoding at
precision ``1e6``). Decoding happens in the backend so the normalizers can hand
the frontend a uniform, MapLibre-ready model.

The standard polyline algorithm yields ``(lat, lon)`` pairs; this decoder swaps
to ``[lon, lat]`` on output so the result is directly consumable by MapLibre /
GeoJSON (Req 12.1).
"""

from __future__ import annotations


class PolylineDecodeError(ValueError):
    """Raised when a polyline6 string is truncated or otherwise undecodable.

    Callers (the OSRM/Valhalla normalizers) catch this to isolate a single
    malformed route without aborting the rest of the response (Req 17.10, 17.11).
    """


def decode_polyline6(encoded: str) -> list[list[float]]:
    """Decode a polyline6 string into ``[lon, lat]`` coordinate pairs.

    Standard Google-polyline variable-length + zig-zag decoding at factor
    ``1e6``, swapping the conventional ``(lat, lon)`` output to ``[lon, lat]``
    for MapLibre (Req 3.1, 3.2, 12.1).

    Args:
        encoded: The polyline6-encoded geometry string.

    Returns:
        A list of ``[lon, lat]`` pairs (empty list for an empty string).

    Raises:
        PolylineDecodeError: If the string is truncated or contains bytes that
            cannot be decoded as a complete varint sequence.
    """
    coords: list[list[float]] = []
    index, lat, lon = 0, 0, 0
    factor = 1e6
    n = len(encoded)
    while index < n:
        for is_lon in (False, True):
            result, shift = 0, 0
            while True:
                if index >= n:
                    # Ran off the end mid-value: truncated / undecodable input.
                    raise PolylineDecodeError(
                        f"truncated polyline6: reached end of input at index {index}"
                    )
                char = encoded[index]
                b = ord(char) - 63
                if b < 0:
                    # Character outside the printable polyline range (< '?').
                    raise PolylineDecodeError(
                        f"invalid polyline6 character {char!r} at index {index}"
                    )
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append([lon / factor, lat / factor])  # [lon, lat] for MapLibre
    return coords
