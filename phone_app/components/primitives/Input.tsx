import React, { forwardRef } from 'react';
import AppInput, { type AppInputProps } from './AppInput';
import type { TextInput } from 'react-native';

export interface InputProps extends AppInputProps {}

const Input = forwardRef<TextInput, InputProps>(function Input(props, ref) {
  const { colors, ...rest } = props;
  return <AppInput ref={ref} colors={colors} {...rest} />;
});

export default Input;
