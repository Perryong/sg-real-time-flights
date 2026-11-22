// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import MovementSummary from "./MovementSummary";
import type { MovementCounts } from "../data/types";
afterEach(cleanup);
const now=Date.parse('2026-11-20T12:00:00+08:00')/1000;
const counts:MovementCounts={day:'2026-11-20',airport:'WSSS',timezone:'Asia/Singapore',available:true,landings:12,takeoffs:9,first_observed_at:now-600,last_observed_at:now,observed_seconds:590,unmonitored_seconds:42610};
it('shows estimated Changi movements and monitoring coverage',()=>{
 render(<MovementSummary counts={counts} now={now} connected />);
 expect(screen.getByLabelText('Detected landings').textContent).toBe('12');
 expect(screen.getByLabelText('Detected takeoffs').textContent).toBe('9');
 expect(screen.getByText(/Estimated · partial coverage/)).toBeTruthy();
 expect(screen.getByText(/20 Nov/)).toBeTruthy();
 expect(screen.getByText(/No detections does not mean no flights/)).toBeTruthy();
});
it('retains saved totals but identifies disconnected updates',()=>{
 render(<MovementSummary counts={counts} now={now+120} connected={false} />);
 expect(screen.getByLabelText('Detected landings').textContent).toBe('12');
 expect(screen.getByText(/Updates paused/)).toBeTruthy();
});
it('never presents yesterday, missing storage or waiting as zero today',()=>{
 const {rerender}=render(<MovementSummary counts={counts} now={now+86400} connected />);
 expect(screen.getByLabelText('Detected landings').textContent).toBe('—');
 rerender(<MovementSummary counts={{...counts,available:false}} now={now} connected />);
 expect(screen.getByText(/Counts unavailable/)).toBeTruthy();
 rerender(<MovementSummary counts={{...counts,first_observed_at:null,last_observed_at:null}} now={now} connected />);
 expect(screen.getByLabelText('Detected takeoffs').textContent).toBe('—');
});
it('shows persisted cloud totals with viewing-only and coverage explanations',()=>{
 render(<MovementSummary counts={counts} now={now} connected onDemand />);
 expect(screen.getByLabelText('Detected landings').textContent).toBe('12');
 expect(screen.getByLabelText('Detected takeoffs').textContent).toBe('9');
 expect(screen.getByText(/Detected today · partial coverage/)).toBeTruthy();
 expect(screen.getByText(/only while someone is viewing/i)).toBeTruthy();
 expect(screen.getByText(/Unmonitored today: 11h 50m/)).toBeTruthy();
});
it('keeps cloud totals through a pause but never relabels yesterday as today',()=>{
 const {rerender}=render(<MovementSummary counts={counts} now={now+600} connected={false} onDemand />);
 expect(screen.getByLabelText('Detected landings').textContent).toBe('12');
 expect(screen.getByText(/Updates paused/)).toBeTruthy();
 expect(screen.getByText(/Unmonitored today: 12h 0m/)).toBeTruthy();
 rerender(<MovementSummary counts={counts} now={now+86400} connected onDemand />);
 expect(screen.getByLabelText('Detected landings').textContent).toBe('—');
 rerender(<MovementSummary counts={{...counts,available:false}} now={now} connected onDemand />);
 expect(screen.getByText(/Counts unavailable/)).toBeTruthy();
 rerender(<MovementSummary counts={null} now={now} connected onDemand />);
 expect(screen.getByLabelText('Detected takeoffs').textContent).toBe('—');
});
