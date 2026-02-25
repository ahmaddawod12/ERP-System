import React from 'react';
import AppButton from './AppButton';

export default function DangerButton(props) {
  return <AppButton variant="destructive" {...props} />;
}
