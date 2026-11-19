# Inference and scenarios

Deterministic version 1.0 rules use accepted observations only, three-sample/ten-second trend windows and two consecutive qualifying evaluations. Tests cover both approach directions, missing touchdown, airborne overflight, stale/unknown/duplicate/gap input, unknown ground/heading, taxi, acceleration, go-around, landing candidates and parallel ambiguity. Runway confidence is capped because geometry is provisional. Landing remains an interval/candidate, never confirmed contact.

The explicit demo contains 16 synthetic tracks over three minutes, generated through normalization/store/inference using an original historical scenario epoch. All identities begin `simulated:fixture:`. It contains no real flights, schedules, routes or aircraft registrations. Generated history is bounded to 60 seconds for fixture size; live history remains five minutes.

No independently reviewed real tracks were available. No real-world confusion matrix or accuracy claim is made. Browser pause/seek/isolation checks follow in the client task.
