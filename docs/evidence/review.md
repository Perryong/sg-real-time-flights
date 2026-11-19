# Independent implementation review

Reviewed range: `e1a075d..fef9318`. Independent read-only reviewer: GPT-6.2 Astra. No critical findings. Six important findings were accepted and fixed in one regression-tested pass:

1. Sequential arrival and go-around phases lost approach history during hysteresis. A bounded private event context now survives pending evaluations, expires after 60 seconds and resets across discontinuities; it is not serialized as a current observation.
2. Queued pre-sleep messages could rewind live time. Suspended connections are invalidated before accepting callbacks, reconnect obtains a full snapshot, and later server messages cannot rewind the estimated clock. Both wake event orderings are tested.
3. Synchronous REST handlers could prune the feed's dictionary from worker threads. State-reading endpoints now execute on the owning event loop; concurrent expiry/read requests and subsequent WebSocket deliveries are tested.
4. Renderer failures left Follow enabled. Startup/context/render failure releases the target and disables Follow, while preserving readable details. Fault-injection browser tests pass.
5. A new ground report overrode buffered airborne height. Display ground state now comes from the displayed observation/bracket. Unknown-height transition brackets use markers rather than an apparently grounded mesh.
6. The benchmark counted browser animation ticks even if the map stopped. It now counts actual Cesium postRender events, actual entities and geographic-view counts, and rejects failure/stopped scenes. An induced WebGL-context loss produces `valid=false` and exit code 1.

Regression tests were observed failing before each implementation correction and passing afterward. Final counts and build results are in release.md. No second review was substituted for the regression suite.

## Deferred minor issues

- An existing map entity retains its first callsign label; the traffic list uses the current callsign.
- Day imagery failure lacks the specific warning attached to night imagery; airport geometry, status and traffic list remain usable.
- Aircraft details show the original position time and display time, but omit separate interpolation-bracket timestamps and the receipt timestamp for unknown-timing positions.

## Evidence outside code review

Provider authorization/terms/timestamp contract/coverage and authoritative runway precision/operational status remain external gates. Performance, clean install and wall-clock stability are supported only to the extent measured in release.md; code review cannot certify them.
