/* Copyright 2017 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/

import {Array1D, Array2D, CheckpointLoader, NDArrayMath, NDArrayMathGPU,
    Scalar} from '../deeplearnjs';

// manifest.json lives in the same directory.
const reader = new CheckpointLoader('.');
reader.getAllVariables().then(vars => {
  const INPUT_SIZE = 388;
  const GENERATE_STEPS = 100;

  const PRIMER_IDX = 355; // shift 1s.

  const math = new NDArrayMathGPU();

  const lstmKernel1 = vars[
      'rnn/multi_rnn_cell/cell_0/basic_lstm_cell/kernel'] as Array2D;
  const lstmBias1 = vars[
      'rnn/multi_rnn_cell/cell_0/basic_lstm_cell/bias'] as Array1D;

  const lstmKernel2 = vars[
      'rnn/multi_rnn_cell/cell_1/basic_lstm_cell/kernel'] as Array2D;
  const lstmBias2 = vars[
      'rnn/multi_rnn_cell/cell_1/basic_lstm_cell/bias'] as Array1D;

  const lstmKernel3 = vars[
      'rnn/multi_rnn_cell/cell_2/basic_lstm_cell/kernel'] as Array2D;
  const lstmBias3 = vars[
      'rnn/multi_rnn_cell/cell_2/basic_lstm_cell/bias'] as Array1D;

  const fullyConnectedBiases = vars['fully_connected/biases'] as Array1D;
  const fullyConnectedWeights = vars['fully_connected/weights'] as Array2D;

  math.scope((keep, track) => {
    const forgetBias = track(Scalar.new(1.0));
    const lstm1 = math.basicLSTMCell.bind(math, forgetBias, lstmKernel1,
        lstmBias1);
    const lstm2 = math.basicLSTMCell.bind(math, forgetBias, lstmKernel2,
        lstmBias2);
    const lstm3 = math.basicLSTMCell.bind(math, forgetBias, lstmKernel3,
        lstmBias3);

    let c = [
        track(Array2D.zeros([1, lstmBias1.shape[0] / 4])),
        track(Array2D.zeros([1, lstmBias2.shape[0] / 4])),
        track(Array2D.zeros([1, lstmBias3.shape[0] / 4])),
        ];
    let h = [
        track(Array2D.zeros([1, lstmBias1.shape[0] / 4])),
        track(Array2D.zeros([1, lstmBias2.shape[0] / 4])),
        track(Array2D.zeros([1, lstmBias3.shape[0] / 4])),
        ];

    let input = track(Array2D.zeros([1, INPUT_SIZE]));
    input.set(1.0, 0, PRIMER_IDX);

    for (let i = 0; i < GENERATE_STEPS; i++) {
      const output = math.multiRNNCell([lstm1, lstm2, lstm3], input, c, h);

      c = output[0];
      h = output[1];

      const outputH = h[2];
      const weightedResult = math.matMul(outputH, fullyConnectedWeights);
      const logits = math.add(weightedResult, fullyConnectedBiases);

      const softmax = math.softmax(logits.as1D());
      const sampledOutput = sampleFromSoftmax(math, softmax);

      const decodedOutput = decodeOutput(sampledOutput);
      document.getElementById('results').innerHTML += (
          '(' + sampledOutput + ') ' + decodedOutput + '<br>');

      // use output as the next input.
      input = track(Array2D.zeros([1, INPUT_SIZE]));
      input.set(1.0, 0, sampledOutput);
    }
  });
});


const MIN_MIDI_PITCH = 0;
const MAX_MIDI_PITCH = 127;
const VELOCITY_BINS = 32;
const MAX_SHIFT_STEPS = 100;
const STEPS_PER_SECOND = 100;

const EVENT_RANGES = [
    ['note_on', MIN_MIDI_PITCH, MAX_MIDI_PITCH],
    ['note_off', MIN_MIDI_PITCH, MAX_MIDI_PITCH],
    ['time_shift', 1, MAX_SHIFT_STEPS],
    ['velocity_change', 1, VELOCITY_BINS],
];

function decodeOutput(index: number) {
  let offset = 0;
  for(const eventRange of EVENT_RANGES) {
    const eventType = eventRange[0] as string;
    const minValue = eventRange[1] as number;
    const maxValue = eventRange[2] as number;

    if (offset <= index && index <= offset + maxValue - minValue) {
      if (eventType === 'note_on') {
        return 'note_on: ' + (index - offset);
      } else if (eventType === 'note_off') {
        return 'note_off: ' + (index - offset);
      } else if (eventType === 'time_shift') {
        return 'time_shift: ' + ((index - offset + 1) / STEPS_PER_SECOND);
      } else if (eventType === 'velocity_change') {
        return 'velocity_change: ' + (
            ((index - offset + 1) * Math.ceil(127 / VELOCITY_BINS)));
      } else {
        throw new Error('Could not decode eventType: ' + eventType);
      }
    }
    offset += maxValue - minValue + 1;
  }
  throw new Error('Could not decode index: ' + index);
}


/**
 * Sample from a softmax.
 */
function sampleFromSoftmax(math: NDArrayMath, softmax: Array1D): number {
  const softmaxValues = softmax.getValues();
  const rand = Scalar.randUniform([], 0, 1).get();
  let cdf = 0;
  for(let i = 0; i < softmaxValues.length; i++) {
    cdf += softmaxValues[i];
    if (cdf > rand) {
      return i;
    }
  }
  throw new Error('Could not sample from softmax.');
}
