# HomePlace Link protocol

This directory contains the canonical, versioned wire schemas used by
HomePlace servers and native clients. A client pins a released protocol version
and must reject messages outside the range reported by `GET /api/link/info`.

Version 1 currently defines the public server description, capability manifests
and the common realtime envelope. Pairing, commands and transfer payloads will
be added without changing the meaning of released fields.

The discovery endpoint is intentionally unauthenticated and contains no
installation secrets. Its `features` object reports only endpoints that are
ready to use, so clients can distinguish a compatible HomePlace installation
from one that does not yet support pairing.
