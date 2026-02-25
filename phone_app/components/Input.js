import React, { forwardRef } from 'react';
import AppInput from './AppInput';

const Input = forwardRef(function Input(props, ref) {
  const { colors, ...rest } = props;
  return <AppInput ref={ref} colors={colors} {...rest} />;
});

export default Input;
