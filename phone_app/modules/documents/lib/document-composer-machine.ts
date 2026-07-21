import type { ModalType } from './create-document-model';

export interface DocumentComposerState {
  readonly modal: {
    readonly visible: boolean;
    readonly type: ModalType;
  };
}

export type DocumentComposerAction =
  | { readonly type: 'OPEN_MODAL'; readonly modalType: Exclude<ModalType, null> }
  | { readonly type: 'CLOSE_MODAL' }
  | { readonly type: 'RESET' };

export const initialDocumentComposerState: DocumentComposerState = {
  modal: { visible: false, type: null },
};

export function documentComposerReducer(
  state: DocumentComposerState,
  action: DocumentComposerAction,
): DocumentComposerState {
  switch (action.type) {
    case 'OPEN_MODAL':
      return { ...state, modal: { visible: true, type: action.modalType } };
    case 'CLOSE_MODAL':
      return { ...state, modal: { visible: false, type: null } };
    case 'RESET':
      return initialDocumentComposerState;
    default:
      return state;
  }
}
