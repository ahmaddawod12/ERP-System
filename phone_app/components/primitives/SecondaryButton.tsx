import React from 'react';
import AppButton, { type AppButtonProps } from './AppButton';

export default function SecondaryButton(props: Omit<AppButtonProps, 'variant'>) {
  return <AppButton variant="secondary" {...props} />;
}
