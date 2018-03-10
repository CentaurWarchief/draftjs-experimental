import "draft-js/dist/Draft.css";

import {
  Modifier,
  CompositeDecorator,
  Editor,
  EditorState,
  getVisibleSelectionRect
} from "draft-js";
import React, { Fragment } from "react";

import DraftOffsetKey from "draft-js/lib/DraftOffsetKey";
import PropTypes from "prop-types";
import ReactDOM from "react-dom";
import { Value } from "react-powerplug";
import createReactContext from "create-react-context";
import findWithRegex from "find-with-regex";
import OnEditorEvent, { callRegisteredEvents } from "./OnEditorEvent";

const MentionSpanOffsetBag = {
  /**
   * @type {[]String}
   */
  offsetKeys: [],

  /**
   * @param {String} offsetKey
   */
  putOffsetKey: function putOffsetKey(offsetKey) {
    this.offsetKeys = this.offsetKeys.concat(offsetKey);
  },

  /**
   * @param {String} offsetKey
   */
  delOffsetKey: function delOffsetKey(offsetKey) {
    this.offsetKeys = this.offsetKeys.filter(
      maybeOffsetKey => offsetKey !== maybeOffsetKey
    );
  },

  /**
   * @returns {[]String}
   */
  getOffsetKeys: function getOffsetKeys() {
    return this.offsetKeys;
  }
};

class DidMountWillUnmount extends React.Component {
  static propTypes = {
    didMount: PropTypes.func.isRequired,
    willUnmount: PropTypes.func.isRequired
  };

  componentDidMount = () => this.props.didMount();

  shouldComponentUpdate() {
    return false;
  }

  componentWillUnmount = () => this.props.willUnmount();

  render() {
    return null;
  }
}

function MentionsSuggestionsPortal({ top, left, children }) {
  return ReactDOM.createPortal(
    <div
      style={{
        position: "absolute",
        top,
        left
      }}
    >
      {children}
    </div>,
    document.body
  );
}

function computeStartRangeRectBounds(global, startOffset) {
  const globalSelection = global.getSelection();

  if (globalSelection.rangeCount === 0) {
    return null;
  }

  const rangeClone = globalSelection.getRangeAt(0).cloneRange();

  if (startOffset >= 0) {
    rangeClone.setStart(rangeClone.startContainer, startOffset);
  }

  const boundingRect = rangeClone.getBoundingClientRect();

  return {
    top: boundingRect.top,
    left: boundingRect.left,
    bottom: boundingRect.bottom,
    right: boundingRect.right
  };
}

function findOffsetKeysLeaves(editorState, decodedOffsetKeys) {
  const currentSelection = editorState.getSelection();
  const anchorKey = currentSelection.getAnchorKey();

  return decodedOffsetKeys
    .filter(decodedOffsetKey => decodedOffsetKey.blockKey === anchorKey)
    .map(decodedOffsetKey =>
      editorState
        .getBlockTree(decodedOffsetKey.blockKey)
        .getIn([
          decodedOffsetKey.decoratorKey,
          "leaves",
          decodedOffsetKey.leafKey
        ])
    )
    .filter(Boolean);
}

function findSelectionBoundsWithinLeaves(currentSelection, leaves) {
  const anchorOffset = currentSelection.getAnchorOffset();

  const leave = leaves.find(({ start, end }) => {
    // let's find out if the cursor anchor is within that leave start/end
    if (anchorOffset >= start && anchorOffset <= end) {
      return true;
    }

    return false;
  });

  return leave || null;
}

const FRUITS = ["Apple", "Orange", "Banana", "Pineapple"];

class FruitsProvider extends React.Component {
  static propTypes = {
    value: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired
  };

  componentWillReceiveProps({ value }) {
    // same values? nah - we aren't doing anything
    if (this.props.value === value) {
      return;
    }

    // do we have some match?
    const nextValues = FRUITS.filter(maybeFruit =>
      maybeFruit.toLowerCase().includes(value)
    );

    this.props.onChange(nextValues);
  }

  render = () => null;
}

function withoutAt(stringWithAt) {
  const atIndex = stringWithAt.indexOf("@");

  return atIndex >= 0
    ? stringWithAt.substring(atIndex + 1, stringWithAt.length)
    : stringWithAt;
}

class InlineMentions extends React.Component {
  state = {
    top: -9999,
    left: -9999,
    mentionQuery: "",
    visible: false
  };

  static propTypes = {
    queryUntilCursor: PropTypes.bool
  };

  static defaultProps = {
    queryUntilCursor: false
  };

  componentWillReceiveProps({ editorState }) {
    // we're using the `setState` callback here to make sure we defer the calculation until the
    // <Editor> rerenders with its latest state
    this.setState(null, () => {
      this.calculateAndSetState(editorState);
    });
  }

  resetState = () =>
    this.setState({
      top: -9999,
      left: -9999,
      visible: false,
      mentionQuery: ""
    });

  calculateAndSetState = editorState => {
    const currentSelection = editorState.getSelection();
    const originalContent = editorState.getCurrentContent();

    if (
      currentSelection.isCollapsed() === false ||
      currentSelection.getHasFocus() === false
    ) {
      this.resetState();
      return;
    }

    const foundBounds = findSelectionBoundsWithinLeaves(
      currentSelection,
      findOffsetKeysLeaves(
        editorState,
        MentionSpanOffsetBag.getOffsetKeys().map(DraftOffsetKey.decode)
      )
    );

    if (foundBounds === null) {
      this.resetState();
      return;
    }

    const anchorKey = currentSelection.getAnchorKey();
    const currentBlock = originalContent.getBlockForKey(anchorKey);
    const plainString = currentBlock.getText();

    let mentionQuery;

    if (this.props.queryUntilCursor) {
      mentionQuery = plainString.substring(
        foundBounds.start,
        Math.min(foundBounds.end, currentSelection.getAnchorOffset())
      );
    } else {
      mentionQuery = plainString.substring(foundBounds.start, foundBounds.end);
    }

    const lastAtIndex = mentionQuery.lastIndexOf("@");

    const activeSelectionRect = computeStartRangeRectBounds(
      window,
      lastAtIndex
    );

    if (activeSelectionRect === null) {
      this.resetState();
      return;
    }

    this.setState({
      top: activeSelectionRect.bottom,
      left: activeSelectionRect.left,
      mentionQuery: mentionQuery.substring(lastAtIndex, mentionQuery.length),
      visible: true
    });
  };

  render() {
    const { activatePortal, children, ...props } = this.props;
    const { visible, top, left, mentionQuery } = this.state;

    return visible ? (
      <MentionsSuggestionsPortal top={top} left={left}>
        {children({
          mentionQuery
        })}
      </MentionsSuggestionsPortal>
    ) : null;
  }
}

function findEntitiesByType(entityType) {
  return (contentBlock, callback, contentState) =>
    contentBlock.findEntityRanges(
      character =>
        character.getEntity() !== null &&
        contentState.getEntity(character.getEntity()).getType() === entityType,
      callback
    );
}

function MentionSpan({ offsetKey, children }) {
  const putOffsetKey = () => MentionSpanOffsetBag.putOffsetKey(offsetKey);
  const delOffsetKey = () => MentionSpanOffsetBag.delOffsetKey(offsetKey);

  return (
    <Fragment>
      <DidMountWillUnmount didMount={putOffsetKey} willUnmount={delOffsetKey} />
      {children}
    </Fragment>
  );
}

function BlueMention({ children }) {
  return <span style={{ backgroundColor: "#ebf4fa" }}>{children}</span>;
}

const MENTION_SPAN_REGEX = /(?:\s|^)@[\w]*/g;

const decorators = new CompositeDecorator([
  {
    strategy: (block, callback) =>
      findWithRegex(MENTION_SPAN_REGEX, block, callback),
    component: MentionSpan
  },
  {
    strategy: findEntitiesByType("MENTION"),
    component: BlueMention
  }
]);

function ExperimentalEditor({ editorState, onChange, children }) {
  return (
    <Fragment>
      <Editor
        placeholder="What's up?"
        editorState={editorState}
        onChange={onChange}
        onDownArrow={callRegisteredEvents("onDownArrow")}
        onUpArrow={callRegisteredEvents("onUpArrow")}
        onEscape={callRegisteredEvents("onEscape")}
        handleReturn={callRegisteredEvents("handleReturn")}
      />

      {children({
        editorState,
        onChange
      })}
    </Fragment>
  );
}

function OurSuggestionBox({ children }) {
  return (
    <div
      style={{
        borderRadius: 4,
        backgroundColor: "#ffffff",
        border: "1px solid #f1f1f1",
        overflow: "hidden"
      }}
    >
      {children}
    </div>
  );
}

function FruitEntry({ children, isActive }) {
  return (
    <li
      style={{
        padding: 10,
        backgroundColor: isActive ? "#105fea" : "#ffffff",
        color: isActive ? "#ffffff" : "inherit"
      }}
    >
      {children}
    </li>
  );
}

class SuggestionSelectionState extends React.Component {
  static propTypes = {
    // how many suggestions are out there?
    suggestionsCount: PropTypes.number.isRequired
  };

  state = {
    selectionIndex: -1
  };

  componentWillReceiveProps({ suggestionsCount }) {
    if (this.props.suggestionsCount !== suggestionsCount) {
      this.setState({
        selectionIndex: -1
      });
    }
  }

  normalizeSelectionIndex = (selectionIndex, suggestionsCount) => {
    const potentialIndex = selectionIndex % suggestionsCount;

    return potentialIndex < 0
      ? potentialIndex + suggestionsCount
      : potentialIndex;
  };

  moveSelectionTo = candidateSelectionIndex => {
    const { selectionIndex } = this.state;
    const { suggestionsCount } = this.props;

    this.setState({
      selectionIndex: this.normalizeSelectionIndex(
        candidateSelectionIndex,
        suggestionsCount
      )
    });
  };

  handleSelectNext = () => {
    event.preventDefault();
    this.moveSelectionTo(this.state.selectionIndex + 1);
  };

  handleSelectPrevious = event => {
    event.preventDefault();
    this.moveSelectionTo(this.state.selectionIndex - 1);
  };

  render() {
    const { selectionIndex } = this.state;
    const { children } = this.props;

    return children({
      selectionIndex,
      moveSelectionToNextItem: this.handleSelectNext,
      moveSelectionToPreviousItem: this.handleSelectPrevious
    });
  }
}

function insertMentionEntity(
  editorState,
  mentionSelection,
  displayText,
  mutability = "SEGMENTED"
) {
  const originalContent = editorState.getCurrentContent();

  const conrentStateAfterMention = originalContent.createEntity(
    "MENTION",
    mutability
  );

  const replacedContent = Modifier.replaceText(
    editorState.getCurrentContent(),
    mentionSelection,
    displayText,
    null,
    conrentStateAfterMention.getLastCreatedEntityKey()
  );

  return EditorState.push(editorState, replacedContent, "apply-entity");
}

function DraftExperimental() {
  return (
    <div style={{ padding: 20 }}>
      <Value initial={EditorState.createEmpty(decorators)}>
        {({ value: editorState, setValue: onChange }) => (
          <Fragment>
            <ExperimentalEditor editorState={editorState} onChange={onChange}>
              {({ editorState, onChange }) => (
                <InlineMentions
                  queryUntilCursor={true}
                  editorState={editorState}
                  onChange={onChange}
                >
                  {({ mentionQuery }) => (
                    <Value initial={[]}>
                      {({
                        value: offeredSuggestions,
                        setValue: offerSuggestions
                      }) => (
                        <OurSuggestionBox>
                          {offeredSuggestions.length > 0 && (
                            <SuggestionSelectionState
                              suggestionsCount={offeredSuggestions.length}
                            >
                              {({
                                selectionIndex,
                                moveSelectionToNextItem,
                                moveSelectionToPreviousItem
                              }) => (
                                <Fragment>
                                  <OnEditorEvent
                                    onUpArrow={moveSelectionToPreviousItem}
                                    onDownArrow={moveSelectionToNextItem}
                                    onEscape={() => offerSuggestions([])}
                                    handleReturn={() => {
                                      if (selectionIndex < 0) {
                                        return;
                                      }

                                      const selectionAfter = editorState
                                        .getCurrentContent()
                                        .getSelectionAfter();

                                      onChange(
                                        insertMentionEntity(
                                          editorState,
                                          selectionAfter.merge({
                                            anchorOffset:
                                              selectionAfter.getFocusOffset() -
                                              mentionQuery.length
                                          }),
                                          offeredSuggestions[selectionIndex]
                                        )
                                      );

                                      return true;
                                    }}
                                  />

                                  <ul
                                    style={{
                                      margin: 0,
                                      padding: 0,
                                      listStyle: "none"
                                    }}
                                  >
                                    {offeredSuggestions.map(
                                      (offeredSuggestion, index) => (
                                        <FruitEntry
                                          key={offeredSuggestion}
                                          isActive={selectionIndex === index}
                                        >
                                          {offeredSuggestion}
                                        </FruitEntry>
                                      )
                                    )}
                                  </ul>
                                </Fragment>
                              )}
                            </SuggestionSelectionState>
                          )}

                          <FruitsProvider
                            value={withoutAt(mentionQuery)}
                            onChange={offerSuggestions}
                          />
                        </OurSuggestionBox>
                      )}
                    </Value>
                  )}
                </InlineMentions>
              )}
            </ExperimentalEditor>
          </Fragment>
        )}
      </Value>
    </div>
  );
}

const DOM_NODE = document.querySelector("#app");

ReactDOM.render(<DraftExperimental />, DOM_NODE);
