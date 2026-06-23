import React from 'react';
import AppButton, { type AppButtonProps } from './AppButton';

export default function PrimaryButton(props: Omit<AppButtonProps, 'variant'>) {
  return <AppButton variant="primary" {...props} />;
}
