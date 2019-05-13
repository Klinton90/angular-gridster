/*global define:true*/
(function(root, factory) {

	'use strict';

	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['angular'], factory);
	} else if (typeof exports === 'object') {
		// CommonJS
		module.exports = factory(require('angular'));
	} else {
		// Browser, nothing "exported". Only registered as a module with angular.
		factory(root.angular);
	}
}(this, function(angular) {

	'use strict';

	// This returned angular module 'gridster' is what is exported.
	return angular.module('gridster', [])

		.constant('gridsterConfig', {
			columns: 6, // number of columns in the grid
			pushing: true, // whether to push other items out of the way
			floating: true, // whether to automatically float items up so they stack
			swapping: false, // whether or not to have items switch places instead of push down if they are the same size
			width: 'auto', // width of the grid. "auto" will expand the grid to its parent container
			colWidth: 'auto', // width of grid columns. "auto" will divide the width of the grid evenly among the columns
			rowHeight: 'match', // height of grid rows. 'match' will make it the same as the column width, a numeric value will be interpreted as pixels, '/2' is half the column width, '*5' is five times the column width, etc.
			margins: [10, 10], // margins in between grid items
			outerMargin: true,
			sparse: false, // "true" can increase performance of dragging and resizing for big grid (e.g. 20x50)
			isMobile: false, // toggle mobile view
			mobileBreakPoint: 600, // width threshold to toggle mobile mode
			mobileModeEnabled: true, // whether or not to toggle mobile mode when screen width is less than mobileBreakPoint
			minColumns: 1, // minimum amount of columns the grid can scale down to
			minRows: 1, // minimum amount of rows to show if the grid is empty
			maxRows: 100, // maximum amount of rows in the grid
			defaultSizeX: 2, // default width of an item in columns
			defaultSizeY: 1, // default height of an item in rows
			minSizeX: 1, // minimum column width of an item
			maxSizeX: null, // maximum column width of an item
			minSizeY: 1, // minumum row height of an item
			maxSizeY: null, // maximum row height of an item
			saveGridItemCalculatedHeightInMobile: false, // grid item height in mobile display. true- to use the calculated height by sizeY given
			resizable: { // options to pass to resizable handler
				enabled: true,
				handles: ['s', 'e', 'n', 'w', 'se', 'ne', 'sw', 'nw']
			},
			draggable: { // options to pass to draggable handler
				enabled: true,
				scrollSensitivity: 20, // Distance in pixels from the edge of the viewport after which the viewport should scroll, relative to pointer
				scrollSpeed: 15 // Speed at which the window should scroll once the mouse pointer gets within scrollSensitivity distance
			}
		})

		.controller('GridsterCtrl', ['gridsterConfig', '$timeout',
			function(gridsterConfig, $timeout) {

				var gridster = this;

				/**
				 * Create options from gridsterConfig constant
				 */
				angular.extend(this, gridsterConfig);

				var originalMaxRows = this.maxRows;

				this.resizable = angular.extend({}, gridsterConfig.resizable || {});
				this.draggable = angular.extend({}, gridsterConfig.draggable || {});

				this.layoutChangedInProgress = false;
				this.layoutChanged = function(heightDelta, callback) {
					if (gridster.layoutChangedInProgress) {
						return;
					}
					gridster.layoutChangedInProgress = true;
					$timeout(function() {
						if (gridster.loaded) {
							gridster.floatItemsUp();
						}
						gridster.updateHeight(heightDelta);
						if (callback) {
							callback();
						}
						gridster.layoutChangedInProgress = false;
					}, 30);
				};

				/**
				 * A positional array of the items in the grid
				 */
				this.grid = [];
				this.allItems = [];

				/**
				 * Clean up after yourself
				 */
				this.destroy = function() {
					// empty the grid to cut back on the possibility
					// of circular references
					if (this.grid) {
						this.grid = [];
					}
					this.$element = null;

					if (this.allItems) {
						this.allItems.length = 0;
						this.allItems = null;
					}
				};

				this.isMovingOrResizing = function(item) {
					return this.movingOrResizingItem === item;
				};

				/**
				 * Overrides default options
				 *
				 * @param {Object} options The options to override
				 */
				this.setOptions = function(options) {
					if (!options) {
						return;
					}

					options = angular.extend({}, options);

					// all this to avoid using jQuery...
					if (options.draggable) {
						angular.extend(this.draggable, options.draggable);
						delete(options.draggable);
					}
					if (options.resizable) {
						angular.extend(this.resizable, options.resizable);
						delete(options.resizable);
					}

					angular.extend(this, options);

					originalMaxRows = this.maxRows;

					if (!this.margins || this.margins.length !== 2) {
						this.margins = [0, 0];
					} else {
						for (var x = 0, l = this.margins.length; x < l; ++x) {
							this.margins[x] = parseInt(this.margins[x], 10);
							if (isNaN(this.margins[x])) {
								this.margins[x] = 0;
							}
						}
					}
				};

				/**
				 * Check if item can occupy a specified position in the grid
				 *
				 * @param {Number} sizeX The Item width
				 * @param {Number} sizeY The Item height
				 * @param {Number} row The row index
				 * @param {Number} column The column index
				 * @returns {Boolean} True if if item fits
				 */
				this.canItemOccupy = function(sizeX, sizeY, row, column) {
					return row > -1 && column > -1 && sizeX + column <= this.columns && sizeY + row <= this.maxRows;
				};

				/**
				 * Set the item in the first suitable position
				 *
				 * @param {Object} item The item to insert
				 */
				this.autoSetItemPosition = function(item) {
					// walk through each row and column looking for a place it will fit
					for (var rowIndex = 0; rowIndex < this.maxRows; ++rowIndex) {
						for (var colIndex = 0; colIndex < this.columns; ++colIndex) {
							// only insert if position is not already taken and it can fit
							var items = this.getItems(rowIndex, colIndex, item.getSizeX(), item.getSizeY(), item);
							if (items.length === 0 && this.canItemOccupy(item.getSizeX(), item.getSizeY(), rowIndex, colIndex)) {
								this.putItem(item, rowIndex, colIndex);
								return;
							}
						}
					}
					throw new Error('Unable to place item!');
				};

				/**
				 * Gets items at a specific coordinate
				 *
				 * @param {Number} row
				 * @param {Number} column
				 * @param {Number} sizeX
				 * @param {Number} sizeY
				 * @param {Array} excludeItems An array of items to exclude from selection
				 * @returns {Array} Items that match the criteria
				 */
				this.getItems = function(row, column, sizeX, sizeY, excludeItems) {
					var items = [];
					if (!sizeX || !sizeY) {
						sizeX = sizeY = 1;
					}
					if (excludeItems && !(excludeItems instanceof Array)) {
						excludeItems = [excludeItems];
					}
					var item;
					if (this.sparse === false) { // check all cells
						for (var h = 0; h < sizeY; ++h) {
							for (var w = 0; w < sizeX; ++w) {
								item = this.getItem(row + h, column + w, excludeItems);
								if (item && (!excludeItems || excludeItems.indexOf(item) === -1) && items.indexOf(item) === -1) {
									items.push(item);
								}
							}
						}
					} else { // check intersection with all items
						var bottom = row + sizeY - 1;
						var right = column + sizeX - 1;
						for (var i = 0; i < this.allItems.length; ++i) {
							item = this.allItems[i];
							if (item && (!excludeItems || excludeItems.indexOf(item) === -1) && items.indexOf(item) === -1 && this.intersect(item, column, right, row, bottom)) {
								items.push(item);
							}
						}
					}
					return items;
				};

				/**
				 * @param {Array} items
				 * @returns {Object} An item that represents the bounding box of the items
				 */
				this.getBoundingBox = function(items) {

					if (items.length === 0) {
						return null;
					}
					if (items.length === 1) {
						return {
							row: items[0].row,
							col: items[0].col,
							sizeY: items[0].getSizeY(),
							sizeX: items[0].getSizeX()
						};
					}

					var maxRow = 0;
					var maxCol = 0;
					var minRow = 9999;
					var minCol = 9999;

					for (var i = 0, l = items.length; i < l; ++i) {
						var item = items[i];
						minRow = Math.min(item.row, minRow);
						minCol = Math.min(item.col, minCol);
						maxRow = Math.max(item.row + item.getSizeY(), maxRow);
						maxCol = Math.max(item.col + item.getSizeX(), maxCol);
					}

					return {
						row: minRow,
						col: minCol,
						sizeY: maxRow - minRow,
						sizeX: maxCol - minCol
					};
				};

				/**
				 * Checks if item intersects specified box
				 *
				 * @param {object} item
				 * @param {number} left
				 * @param {number} right
				 * @param {number} top
				 * @param {number} bottom
				 */
				this.intersect = function(item, left, right, top, bottom) {
					return (left <= item.col + item.getSizeX() - 1 &&
						right >= item.col &&
						top <= item.row + item.getSizeY() - 1 &&
						bottom >= item.row);
				};


				/**
				 * Removes an item from the grid
				 *
				 * @param {Object} item
				 */
				this.removeItem = function(item) {
					var index;
					for (var rowIndex = 0, l = this.grid.length; rowIndex < l; ++rowIndex) {
						var columns = this.grid[rowIndex];
						if (!columns) {
							continue;
						}
						index = columns.indexOf(item);
						if (index !== -1) {
							columns[index] = null;
							break;
						}
					}
					if (this.sparse) {
						index = this.allItems.indexOf(item);
						if (index !== -1) {
							this.allItems.splice(index, 1);
						}
					}
					// Recalculate grid height, based on new set of items
					this.layoutChanged();
				};

				/**
				 * Returns the item at a specified coordinate
				 *
				 * @param {Number} row
				 * @param {Number} column
				 * @param {Array} excludeItems Items to exclude from selection
				 * @returns {Object} The matched item or null
				 */
				this.getItem = function(row, column, excludeItems) {
					if (excludeItems && !(excludeItems instanceof Array)) {
						excludeItems = [excludeItems];
					}
					var sizeY = 1;
					while (row > -1) {
						var sizeX = 1,
							col = column;
						while (col > -1) {
							var items = this.grid[row];
							if (items) {
								var item = items[col];
								if (item && (!excludeItems || excludeItems.indexOf(item) === -1) && item.getSizeX() >= sizeX && item.getSizeY() >= sizeY) {
									return item;
								}
							}
							++sizeX;
							--col;
						}
						--row;
						++sizeY;
					}
					return null;
				};

				/**
				 * Insert an array of items into the grid
				 *
				 * @param {Array} items An array of items to insert
				 */
				this.putItems = function(items) {
					for (var i = 0, l = items.length; i < l; ++i) {
						this.putItem(items[i]);
					}
				};

				/**
				 * Insert a single item into the grid
				 *
				 * @param {Object} item The item to insert
				 * @param {Number} row (Optional) Specifies the items row index
				 * @param {Number} column (Optional) Specifies the items column index
				 * @param {Array} ignoreItems
				 * @param {Boolean} isDropAction
				 */
				this.putItem = function(item, row, column, ignoreItems, isDropAction) {
					// auto place item if no row specified
					if (typeof row === 'undefined' || row === null) {
						row = item.row;
						column = item.col;
						if (typeof row === 'undefined' || row === null) {
							this.autoSetItemPosition(item);
							return;
						}
					}

					// keep item within allowed bounds
					if (!this.canItemOccupy(item.getSizeX(), item.getSizeY(), row, column)) {
						column = Math.min(this.columns - item.getSizeX(), Math.max(0, column));
						row = Math.min(this.maxRows - item.getSizeY(), Math.max(0, row));
					}

					// check if item is already in grid
					if (item.oldRow !== null && typeof item.oldRow !== 'undefined') {
						var samePosition = item.oldRow === row && item.oldColumn === column;
						var inGrid = this.grid[row] && this.grid[row][column] === item;
						if (samePosition && inGrid) {
							item.row = row;
							item.col = column;
							return;
						} else {
							// remove from old position
							var oldRow = this.grid[item.oldRow];
							if (oldRow && oldRow[item.oldColumn] === item) {
								delete oldRow[item.oldColumn];
							}
						}
					}

					item.oldRow = item.row = row;
					item.oldColumn = item.col = column;

					this.moveOverlappingItems(item, ignoreItems, isDropAction);

					if (!this.grid[row]) {
						this.grid[row] = [];
					}
					this.grid[row][column] = item;

					if (this.sparse && this.allItems.indexOf(item) === -1) {
						this.allItems.push(item);
					}

					if (this.isMovingOrResizing(item)) {
						this.floatItemUp(item);
					}

					this.layoutChanged(gridster.movingOrResizingItem ? gridster.movingOrResizingItem.getSizeY() : 0);
				};

				/**
				 * Trade row and column if item1 with item2
				 *
				 * @param {Object} item1
				 * @param {Object} item2
				 */
				this.swapItems = function(item1, item2) {
					this.grid[item1.row][item1.col] = item2;
					this.grid[item2.row][item2.col] = item1;

					var item1Row = item1.row;
					var item1Col = item1.col;
					item1.row = item2.row;
					item1.col = item2.col;
					item2.row = item1Row;
					item2.col = item1Col;
				};

				/**
				 * Prevents items from being overlapped
				 *
				 * @param {Object} item The item that should remain
				 * @param {Array} ignoreItems
				 * @param {Boolean} isDropAction
				 */
				this.moveOverlappingItems = function(item, ignoreItems, isDropAction) {
					var _ignoreItems;
					// don't move item, so ignore it
					if (!ignoreItems) {
						_ignoreItems = [item];
					} else if (ignoreItems.indexOf(item) === -1) {
						_ignoreItems = ignoreItems.slice(0);
						_ignoreItems.push(item);
					}

					// get the items in the space occupied by the item's coordinates
					var overlappingItems = this.getItems(
						item.row,
						item.col,
						item.getSizeX(),
						item.getSizeY(),
						_ignoreItems
					);

					if (gridster.loaded && !gridster.isMovingOrResizing(item) && !isDropAction) {
						var topItem = overlappingItems.filter(function(overlappingItem) {
							return overlappingItem.row < item.row;
						}).sort(function(a, b) {
							return b.row - a.row;
						})[0];

						if (topItem) {
							var $ignoreItems = ignoreItems ? ignoreItems.slice(0) : null;
							if ($ignoreItems) {
								var i = $ignoreItems.indexOf(item);
								if (i !== -1) {
									$ignoreItems.splice(i, 1);
								}
							}
							this.moveOverlappingItems(topItem, $ignoreItems);
							item.isRendered = true;
							return;
						}
					}

					this.moveItemsDown(overlappingItems, item.row + item.getSizeY(), _ignoreItems);
				};

				/**
				 * Moves an array of items to a specified row
				 *
				 * @param {Array} items The items to move
				 * @param {Number} newRow The target row
				 * @param {Array} ignoreItems
				 */
				this.moveItemsDown = function(items, newRow, ignoreItems) {
					if (!items || items.length === 0) {
						return;
					}
					items.sort(function(a, b) {
						return a.row - b.row;
					});

					ignoreItems = ignoreItems ? ignoreItems.slice(0) : [];
					var topRows = {},
						item, i, l;

					// calculate the top rows in each column
					for (i = 0, l = items.length; i < l; ++i) {
						item = items[i];
						var topRow = topRows[item.col];
						if (typeof topRow === 'undefined' || item.row < topRow) {
							topRows[item.col] = item.row;
						}
					}

					// move each item down from the top row in its column to the row
					for (i = 0, l = items.length; i < l; ++i) {
						item = items[i];
						var rowsToMove = newRow - topRows[item.col];
						this.moveItemDown(item, item.row + rowsToMove, ignoreItems);
						ignoreItems.push(item);
					}
				};

				/**
				 * Moves an item down to a specified row
				 *
				 * @param {Object} item The item to move
				 * @param {Number} newRow The target row
				 * @param {Array} ignoreItems
				 */
				this.moveItemDown = function(item, newRow, ignoreItems) {
					if (item.row >= newRow) {
						return;
					}
					while (item.row < newRow) {
						++item.row;
						this.moveOverlappingItems(item, ignoreItems);
					}
					this.putItem(item, item.row, item.col, ignoreItems);
				};

				/**
				 * Moves all items up as much as possible
				 */
				this.floatItemsUp = function() {
					if (this.floating === false) {
						return;
					}
					for (var rowIndex = 0, l = this.grid.length; rowIndex < l; ++rowIndex) {
						var columns = this.grid[rowIndex];
						if (!columns) {
							continue;
						}
						for (var colIndex = 0, len = columns.length; colIndex < len; ++colIndex) {
							var item = columns[colIndex];
							if (item) {
								this.floatItemUp(item);
							}
						}
					}
				};

				/**
				 * Float an item up to the most suitable row
				 *
				 * @param {Object} item The item to move
				 */
				this.floatItemUp = function(item) {
					if (this.floating === false) {
						return;
					}
					var colIndex = item.col,
						sizeY = item.getSizeY(),
						sizeX = item.getSizeX(),
						bestRow = null,
						bestColumn = null,
						rowIndex = item.row - 1;

					while (rowIndex > -1) {
						var items = this.getItems(rowIndex, colIndex, sizeX, sizeY, item);
						if (items.length !== 0) {
							break;
						}
						bestRow = rowIndex;
						bestColumn = colIndex;
						--rowIndex;
					}
					if (bestRow !== null) {
						this.putItem(item, bestRow, bestColumn);
					}
				};

				/**
				 * Update gridsters height
				 *
				 * @param {Number} heightDelta (Optional) Additional height to add
				 * @param {Any} item (Optional) Item to subtract height from for calculation. Required when `heightDelta` is negative.
				 */
				this.updateHeight = function(heightDelta, item) {
					var maxHeight = this.minRows;
					heightDelta = heightDelta || 0;
					for (var rowIndex = this.grid.length; rowIndex >= 0; --rowIndex) {
						var columns = this.grid[rowIndex];
						if (!columns) {
							continue;
						}
						for (var colIndex = 0, len = columns.length; colIndex < len; ++colIndex) {
							if (columns[colIndex]) {
								if (heightDelta < 0) {
									if (item) {
										if (columns[colIndex] === item) {
											maxHeight = Math.max(maxHeight, rowIndex + heightDelta + columns[colIndex].getSizeY());
										} else {
											maxHeight = Math.max(maxHeight, rowIndex + columns[colIndex].getSizeY());
										}
									} else {
										console.error('Negative `heightDelta` provided and no `item`! That is unexpected behavior. Please inspect your code for errors.');
										maxHeight = Math.max(maxHeight, rowIndex + (-heightDelta) + columns[colIndex].getSizeY());
									}
								} else {
									maxHeight = Math.max(maxHeight, rowIndex + heightDelta + columns[colIndex].getSizeY());
								}
							}
						}
					}
					this.gridHeight = this.maxRows - maxHeight > 0 ? Math.min(this.maxRows, maxHeight) : Math.max(this.maxRows, maxHeight);
				};

				/**
				 * Returns the number of rows that will fit in given amount of pixels
				 *
				 * @param {Number} pixels
				 * @param {Boolean} ceilOrFloor (Optional) Determines rounding method
				 */
				this.pixelsToRows = function(pixels, ceilOrFloor, isForDrag) {
					if (!this.outerMargin) {
						if (isForDrag) {
							pixels += this.margins[0] / 2;
						} else {
							pixels += this.margins[0];
						}
					}

					if (ceilOrFloor === true) {
						return Math.ceil(pixels / this.curRowHeight);
					} else if (ceilOrFloor === false) {
						return Math.floor(pixels / this.curRowHeight);
					}

					return Math.round(pixels / this.curRowHeight);
				};

				/**
				 * Returns the number of columns that will fit in a given amount of pixels
				 *
				 * @param {Number} pixels
				 * @param {Boolean} ceilOrFloor (Optional) Determines rounding method
				 * @returns {Number} The number of columns
				 */
				this.pixelsToColumns = function(pixels, ceilOrFloor) {
					if (!this.outerMargin) {
						pixels += this.margins[1] / 2;
					}

					if (ceilOrFloor === true) {
						return Math.ceil(pixels / this.curColWidth);
					} else if (ceilOrFloor === false) {
						return Math.floor(pixels / this.curColWidth);
					}

					return Math.round(pixels / this.curColWidth);
				};
			}
		])

		.directive('gridsterPreview', function() {
			return {
				replace: true,
				scope: true,
				require: '^gridster',
				template: '<div ng-style="previewStyle()" class="gridster-item gridster-preview-holder"></div>',
				link: function(scope, $el, attrs, gridster) {

					/**
					 * @returns {Object} style object for preview element
					 */
					scope.previewStyle = function() {
						if (!gridster.movingOrResizingItem) {
							return {
								display: 'none'
							};
						}

						return {
							display: 'block',
							height: (gridster.movingOrResizingItem.getSizeY() * gridster.curRowHeight - gridster.margins[0]) + 'px',
							width: (gridster.movingOrResizingItem.getSizeX() * gridster.curColWidth - gridster.margins[1]) + 'px',
							top: (gridster.movingOrResizingItem.row * gridster.curRowHeight + (gridster.outerMargin ? gridster.margins[0] : 0)) + 'px',
							left: (gridster.movingOrResizingItem.col * gridster.curColWidth + (gridster.outerMargin ? gridster.margins[1] : 0)) + 'px'
						};
					};
				}
			};
		})

		/**
		 * The gridster directive
		 *
		 * @param {Function} $timeout
		 * @param {Object} $window
		 * @param {Object} $rootScope
		 * @param {Function} gridsterDebounce
		 */
		.directive('gridster', ['$timeout', '$window', '$rootScope', 'gridsterDebounce',
			function($timeout, $window, $rootScope, gridsterDebounce) {
				return {
					scope: true,
					restrict: 'EAC',
					controller: 'GridsterCtrl',
					controllerAs: 'gridster',
					compile: function($tplElem) {

						$tplElem.prepend('<div ng-if="gridster.movingOrResizingItem" gridster-preview></div>');

						return function(scope, $elem, attrs, gridster) {
							gridster.loaded = false;

							gridster.$element = $elem;

							scope.gridster = gridster;

							$elem.addClass('gridster');

							var isVisible = function(ele) {
								return ele.style.visibility !== 'hidden' && ele.style.display !== 'none';
							};

							function updateHeight() {
								$elem.css('height', (gridster.gridHeight * gridster.curRowHeight) + (gridster.outerMargin ? gridster.margins[0] : -gridster.margins[0]) + 'px');
							}

							scope.$watch(function() {
								return gridster.gridHeight;
							}, updateHeight);

							function refresh(config) {
								gridster.setOptions(config);

								if (!isVisible($elem[0])) {
									return;
								}

								var curWidth;
								// resolve "auto" & "match" values
								if (gridster.width === 'auto') {
									curWidth = $elem[0].offsetWidth || parseInt($elem.css('width'), 10);
								} else {
									curWidth = gridster.width;
								}

								if (curWidth) {
									gridster.curWidth = curWidth;
								} else {
									return;
								}

								if (gridster.colWidth === 'auto') {
									gridster.curColWidth = (gridster.curWidth + (gridster.outerMargin ? -gridster.margins[1] : gridster.margins[1])) / gridster.columns;
								} else {
									gridster.curColWidth = gridster.colWidth;
								}

								gridster.curRowHeight = gridster.rowHeight;
								if (typeof gridster.rowHeight === 'string') {
									if (gridster.rowHeight === 'match') {
										gridster.curRowHeight = Math.round(gridster.curColWidth);
									} else if (gridster.rowHeight.indexOf('*') !== -1) {
										gridster.curRowHeight = Math.round(gridster.curColWidth * gridster.rowHeight.replace('*', '').replace(' ', ''));
									} else if (gridster.rowHeight.indexOf('/') !== -1) {
										gridster.curRowHeight = Math.round(gridster.curColWidth / gridster.rowHeight.replace('/', '').replace(' ', ''));
									}
								}

								gridster.isMobile = gridster.mobileModeEnabled && gridster.curWidth <= gridster.mobileBreakPoint;

								// loop through all items and reset their CSS
								for (var rowIndex = 0, l = gridster.grid.length; rowIndex < l; ++rowIndex) {
									var columns = gridster.grid[rowIndex];
									if (!columns) {
										continue;
									}

									for (var colIndex = 0, len = columns.length; colIndex < len; ++colIndex) {
										if (columns[colIndex]) {
											var item = columns[colIndex];
											item.setElementPosition();
											item.setElementSizeY();
											item.setElementSizeX();
										}
									}
								}

								updateHeight();
							}

							var optionsKey = attrs.gridster;
							if (optionsKey) {
								scope.$parent.$watch(optionsKey, function(newConfig) {
									refresh(newConfig);
								}, true);
							} else {
								refresh({});
							}

							scope.$watch(function() {
								return gridster.loaded;
							}, function() {
								if (gridster.loaded) {
									$elem.addClass('gridster-loaded');
									$rootScope.$broadcast('gridster-loaded', gridster);
								} else {
									$elem.removeClass('gridster-loaded');
								}
							});

							scope.$watch(function() {
								return gridster.isMobile;
							}, function() {
								if (gridster.isMobile) {
									$elem.addClass('gridster-mobile').removeClass('gridster-desktop');
								} else {
									$elem.removeClass('gridster-mobile').addClass('gridster-desktop');
								}
								$rootScope.$broadcast('gridster-mobile-changed', gridster);
							});

							scope.$watch(function() {
								return gridster.draggable;
							}, function() {
								$rootScope.$broadcast('gridster-draggable-changed', gridster);
							}, true);

							scope.$watch(function() {
								return gridster.resizable;
							}, function() {
								$rootScope.$broadcast('gridster-resizable-changed', gridster);
							}, true);

							var prevWidth = $elem[0].offsetWidth || parseInt($elem.css('width'), 10);

							var resize = function() {
								gridster.$resizeInProgress = true;
								var width = $elem[0].offsetWidth || parseInt($elem.css('width'), 10);

								if (!width || width === prevWidth || gridster.movingOrResizingItem) {
									return;
								}
								prevWidth = width;

								if (gridster.loaded) {
									$elem.removeClass('gridster-loaded');
								}

								refresh();

								if (gridster.loaded) {
									$elem.addClass('gridster-loaded');
								}

								$rootScope.$broadcast('gridster-resized', [width, $elem[0].offsetHeight], gridster);
							};

							// track element width changes any way we can
							var onResize = gridsterDebounce(function onResize() {
								resize();
								$timeout(function() {
									gridster.$resizeInProgress = false;
									scope.$apply();
								});
							}, 100);

							scope.$watch(function() {
								return isVisible($elem[0]);
							}, onResize);

							// see https://github.com/sdecima/javascript-detect-element-resize
							if (typeof window.addResizeListener === 'function') {
								window.addResizeListener($elem[0], onResize);
							} else {
								scope.$watch(function() {
									return $elem[0].offsetWidth || parseInt($elem.css('width'), 10);
								}, resize);
							}
							var $win = angular.element($window);
							$win.on('resize', onResize);

							// be sure to cleanup
							scope.$on('$destroy', function() {
								gridster.destroy();
								$win.off('resize', onResize);
								if (typeof window.removeResizeListener === 'function') {
									window.removeResizeListener($elem[0], onResize);
								}
							});

							// allow a little time to place items before floating up
							$timeout(function() {
								scope.$watch('gridster.floating', function() {
									gridster.floatItemsUp();
								});
								gridster.loaded = true;
							}, 100);
						};
					}
				};
			}
		])

		.controller('GridsterItemCtrl', function() {
			this.$element = null;
			this.gridster = null;
			this.row = null;
			this.col = null;
			this.sizeX = null;
			this.sizeY = null;
			this.minSizeX = 0;
			this.minSizeY = 0;
			this.maxSizeX = null;
			this.maxSizeY = null;
			this.restrictByContentX = false;
			this.restrictByContentY = false;
			this.adjustmentInProgress = 0;

			this.init = function($element, gridster) {
				this.$element = $element;
				this.gridster = gridster;
				this.sizeX = gridster.defaultSizeX;
				this.sizeY = gridster.defaultSizeY;
			};

			this.destroy = function() {
				// set these to null to avoid the possibility of circular references
				this.gridster = null;
				this.$element = null;
			};

			/**
			 * Returns the items most important attributes
			 */
			this.toJSON = function() {
				return {
					row: this.row,
					col: this.col,
					sizeY: this.sizeY,
					sizeX: this.sizeX
				};
			};

			/**
			 * Set the items position
			 *
			 * @param {Number} row
			 * @param {Number} column
			 * @param {Boolean} isDropAction
			 */
			this.setPosition = function(row, column, isDropAction) {
				this.gridster.putItem(this, row, column, null, isDropAction);

				if (!this.gridster.isMovingOrResizing(this)) {
					this.setElementPosition();
				}
			};

			/**
			 * Sets a specified size property
			 *
			 * @param {String} key Can be either "x" or "y"
			 * @param {Number} value The size amount
			 */
			this.setSize = function(key, value) {
				key = key.toUpperCase();
				var camelCase = 'size' + key,
					titleCase = 'Size' + key;
				if (value === '') {
					return;
				}

				var auto = value === 'auto';
				var contentValue = this['getContent' + titleCase]();

				if (auto) {
					value = contentValue;
				} else {
					value = parseInt(value, 10);

					if (isNaN(value) || value === 0) {
						value = this.gridster['default' + titleCase];
					}

					if (contentValue > value) {
						value = contentValue;
					}
				}

				if (key === 'X' && this.col + value > this.gridster.columns) {
					value = this.gridster.columns - this.col;
				}

				var max = key === 'X' ? this.gridster.columns : this.gridster.maxRows;
				if (this['max' + titleCase]) {
					max = Math.min(this['max' + titleCase], max);
				}
				if (this.gridster['max' + titleCase]) {
					max = Math.min(this.gridster['max' + titleCase], max);
				}
				if (key === 'X' && this.cols) {
					max -= this.cols;
				} else if (key === 'Y' && this.rows) {
					max -= this.rows;
				}

				var min = 0;
				if (this['min' + titleCase]) {
					min = Math.max(this['min' + titleCase], min);
				}
				if (this.gridster['min' + titleCase]) {
					min = Math.max(this.gridster['min' + titleCase], min);
				}

				value = Math.max(Math.min(value, max), min);

				var changed = value - this[camelCase];
				if (!changed && this['old' + titleCase]) {
					changed = value - this['old' + titleCase];
				}
				this['old' + titleCase] = value;

				if (!auto) {
					this[camelCase] = value;
				}

				if (!this.gridster.isMovingOrResizing(this) || this['actualOld' + titleCase] === 'auto') {
					this['setElement' + titleCase]();
				}

				return changed;
			};

			/**
			 * Sets the items sizeY property
			 *
			 * @param {Number} rows
			 */
			this.setSizeY = function(rows) {
				return this.setSize('Y', rows);
			};

			/**
			 * Sets the items sizeX property
			 *
			 * @param {Number} columns
			 */
			this.setSizeX = function(columns) {
				return this.setSize('X', columns);
			};

			this.isAutoChangedX = function() {
				return (this.sizeX === 'auto' && this.actualOldSizeX !== 'auto') ||
					(this.sizeX !== 'auto' && this.actualOldSizeX === 'auto');
			};

			this.isAutoChangedY = function() {
				return (this.sizeY === 'auto' && this.actualOldSizeY !== 'auto') ||
					(this.sizeY !== 'auto' && this.actualOldSizeY === 'auto');
			};

			/**
			 * Gets the items sizeY property
			 */
			this.getSizeY = function() {
				var contentSizeY = this.getContentSizeY();
				return this.sizeY === 'auto' || contentSizeY > this.sizeY ? contentSizeY : this.sizeY;
			};

			this.getContentSizeY = function() {
				return this.gridster.pixelsToRows(this.$element[0].scrollHeight, true);
			};

			/**
			 * Gets the items sizeX property
			 */
			this.getSizeX = function() {
				var contentSizeX = this.getContentSizeX();

				var result = this.sizeX === 'auto' || contentSizeX > this.sizeX ? contentSizeX : this.sizeX;

				if ((this.col + result) > this.gridster.columns) {
					result = this.gridster.columns - this.col;
				}

				return result;
			};

			this.getContentSizeX = function() {
				return this.gridster.pixelsToColumns(this.$element[0].scrollWidth, true);
			};

			/**
			 * Sets an elements position on the page
			 */
			this.setElementPosition = function() {
				if (this.gridster.isMobile) {
					this.$element.css({
						marginLeft: this.gridster.margins[0] + 'px',
						marginRight: this.gridster.margins[0] + 'px',
						marginTop: this.gridster.margins[1] + 'px',
						marginBottom: this.gridster.margins[1] + 'px',
						top: '',
						left: ''
					});
				} else {
					this.$element.css({
						margin: 0,
						top: (this.row * this.gridster.curRowHeight + (this.gridster.outerMargin ? this.gridster.margins[0] : 0)) + 'px',
						left: (this.col * this.gridster.curColWidth + (this.gridster.outerMargin ? this.gridster.margins[1] : 0)) + 'px'
					});
				}
			};

			/**
			 * Sets an elements height
			 */
			this.setElementSizeY = function() {
				if ((this.gridster.isMobile && !this.gridster.saveGridItemCalculatedHeightInMobile) || this.sizeY === 'auto') {
					this.$element
						.css('height', '')
						.addClass('auto-height');
				} else {
					this.$element
						.css('height', (this.getSizeY() * this.gridster.curRowHeight - this.gridster.margins[0]) + 'px')
						.removeClass('auto-height');
				}
			};

			/**
			 * Sets an elements width
			 */
			this.setElementSizeX = function() {
				if (this.gridster.isMobile) {
					this.$element.css('width', '');
				} else {
					this.$element.css('width', (this.getSizeX() * this.gridster.curColWidth - this.gridster.margins[1]) + 'px');
				}
			};

			/**
			 * Gets an element's width
			 */
			this.getElementSizeX = function() {
				return (this.getSizeX() * this.gridster.curColWidth - this.gridster.margins[1]);
			};

			/**
			 * Gets an element's height
			 */
			this.getElementSizeY = function() {
				return (this.getSizeY() * this.gridster.curRowHeight - this.gridster.margins[0]);
			};

		})

		.factory('GridsterTouch', [function() {
			return function GridsterTouch(target, startEvent, moveEvent, endEvent) {
				var lastXYById = {};

				//  Opera doesn't have Object.keys so we use this wrapper
				var numberOfKeys = function(theObject) {
					if (Object.keys) {
						return Object.keys(theObject).length;
					}

					var n = 0,
						key;
					for (key in theObject) {
						++n;
					}

					return n;
				};

				//  this calculates the delta needed to convert pageX/Y to offsetX/Y because offsetX/Y don't exist in the TouchEvent object or in Firefox's MouseEvent object
				var computeDocumentToElementDelta = function(theElement) {
					var elementLeft = 0;
					var elementTop = 0;
					var oldIEUserAgent = navigator.userAgent.match(/\bMSIE\b/);

					for (var offsetElement = theElement; offsetElement != null; offsetElement = offsetElement.offsetParent) {
						//  the following is a major hack for versions of IE less than 8 to avoid an apparent problem on the IEBlog with double-counting the offsets
						//  this may not be a general solution to IE7's problem with offsetLeft/offsetParent
						if (oldIEUserAgent &&
							(!document.documentMode || document.documentMode < 8) &&
							offsetElement.currentStyle.position === 'relative' && offsetElement.offsetParent && offsetElement.offsetParent.currentStyle.position === 'relative' && offsetElement.offsetLeft === offsetElement.offsetParent.offsetLeft) {
							// add only the top
							elementTop += offsetElement.offsetTop;
						} else {
							elementLeft += offsetElement.offsetLeft;
							elementTop += offsetElement.offsetTop;
						}
					}

					return {
						x: elementLeft,
						y: elementTop
					};
				};

				//  cache the delta from the document to our event target (reinitialized each mousedown/MSPointerDown/touchstart)
				var documentToTargetDelta = computeDocumentToElementDelta(target);
				var useSetReleaseCapture = false;

				//  common event handler for the mouse/pointer/touch models and their down/start, move, up/end, and cancel events
				var doEvent = function(theEvtObj) {

					if (theEvtObj.type === 'mousemove' && numberOfKeys(lastXYById) === 0) {
						return;
					}

					var prevent = true;

					var pointerList = theEvtObj.changedTouches ? theEvtObj.changedTouches : [theEvtObj];
					for (var i = 0; i < pointerList.length; ++i) {
						var pointerObj = pointerList[i];
						var pointerId = (typeof pointerObj.identifier !== 'undefined') ? pointerObj.identifier : (typeof pointerObj.pointerId !== 'undefined') ? pointerObj.pointerId : 1;

						//  use the pageX/Y coordinates to compute target-relative coordinates when we have them (in ie < 9, we need to do a little work to put them there)
						if (typeof pointerObj.pageX === 'undefined') {
							//  initialize assuming our source element is our target
							pointerObj.pageX = pointerObj.offsetX + documentToTargetDelta.x;
							pointerObj.pageY = pointerObj.offsetY + documentToTargetDelta.y;

							if (pointerObj.srcElement.offsetParent === target && document.documentMode && document.documentMode === 8 && pointerObj.type === 'mousedown') {
								//  source element is a child piece of VML, we're in IE8, and we've not called setCapture yet - add the origin of the source element
								pointerObj.pageX += pointerObj.srcElement.offsetLeft;
								pointerObj.pageY += pointerObj.srcElement.offsetTop;
							} else if (pointerObj.srcElement !== target && !document.documentMode || document.documentMode < 8) {
								//  source element isn't the target (most likely it's a child piece of VML) and we're in a version of IE before IE8 -
								//  the offsetX/Y values are unpredictable so use the clientX/Y values and adjust by the scroll offsets of its parents
								//  to get the document-relative coordinates (the same as pageX/Y)
								var sx = -2,
									sy = -2; // adjust for old IE's 2-pixel border
								for (var scrollElement = pointerObj.srcElement; scrollElement !== null; scrollElement = scrollElement.parentNode) {
									sx += scrollElement.scrollLeft ? scrollElement.scrollLeft : 0;
									sy += scrollElement.scrollTop ? scrollElement.scrollTop : 0;
								}

								pointerObj.pageX = pointerObj.clientX + sx;
								pointerObj.pageY = pointerObj.clientY + sy;
							}
						}


						var pageX = pointerObj.pageX;
						var pageY = pointerObj.pageY;

						if (theEvtObj.type.match(/(start|down)$/i)) {
							//  clause for processing MSPointerDown, touchstart, and mousedown

							//  refresh the document-to-target delta on start in case the target has moved relative to document
							documentToTargetDelta = computeDocumentToElementDelta(target);

							//  protect against failing to get an up or end on this pointerId
							if (lastXYById[pointerId]) {
								if (endEvent) {
									endEvent({
										target: theEvtObj.target,
										which: theEvtObj.which,
										pointerId: pointerId,
										pageX: pageX,
										pageY: pageY
									});
								}

								delete lastXYById[pointerId];
							}

							if (startEvent) {
								if (prevent) {
									prevent = startEvent({
										target: theEvtObj.target,
										which: theEvtObj.which,
										pointerId: pointerId,
										pageX: pageX,
										pageY: pageY
									});
								}
							}

							//  init last page positions for this pointer
							lastXYById[pointerId] = {
								x: pageX,
								y: pageY
							};

							// IE pointer model
							if (target.msSetPointerCapture && prevent) {
								target.msSetPointerCapture(pointerId);
							} else if (theEvtObj.type === 'mousedown' && numberOfKeys(lastXYById) === 1) {
								if (useSetReleaseCapture) {
									target.setCapture(true);
								} else {
									document.addEventListener('mousemove', doEvent, false);
									document.addEventListener('mouseup', doEvent, false);
									document.addEventListener('mouseleave', doEvent, false);
								}
							}
						} else if (theEvtObj.type.match(/move$/i)) {
							//  clause handles mousemove, MSPointerMove, and touchmove

							if (lastXYById[pointerId] && !(lastXYById[pointerId].x === pageX && lastXYById[pointerId].y === pageY)) {
								//  only extend if the pointer is down and it's not the same as the last point

								if (moveEvent && prevent) {
									prevent = moveEvent({
										target: theEvtObj.target,
										which: theEvtObj.which,
										pointerId: pointerId,
										pageX: pageX,
										pageY: pageY
									});
								}

								//  update last page positions for this pointer
								lastXYById[pointerId].x = pageX;
								lastXYById[pointerId].y = pageY;
							}
						} else if (lastXYById[pointerId] && theEvtObj.type.match(/(up|end|cancel|leave)$/i)) {
							//  clause handles up/end/cancel

							if (endEvent && prevent) {
								prevent = endEvent({
									target: theEvtObj.target,
									which: theEvtObj.which,
									pointerId: pointerId,
									pageX: pageX,
									pageY: pageY
								});
							}

							//  delete last page positions for this pointer
							delete lastXYById[pointerId];

							//  in the Microsoft pointer model, release the capture for this pointer
							//  in the mouse model, release the capture or remove document-level event handlers if there are no down points
							//  nothing is required for the iOS touch model because capture is implied on touchstart
							if (target.msReleasePointerCapture) {
								target.msReleasePointerCapture(pointerId);
							} else if (theEvtObj.type === 'mouseup' && numberOfKeys(lastXYById) === 0) {
								if (useSetReleaseCapture) {
									target.releaseCapture();
								} else {
									document.removeEventListener('mousemove', doEvent, false);
									document.removeEventListener('mouseup', doEvent, false);
									document.removeEventListener('mouseleave', doEvent, false);
								}
							}
						}
					}

					if (prevent) {
						if (theEvtObj.preventDefault) {
							theEvtObj.preventDefault();
						}

						if (theEvtObj.preventManipulation) {
							theEvtObj.preventManipulation();
						}

						if (theEvtObj.preventMouseEvent) {
							theEvtObj.preventMouseEvent();
						}
					}
				};

				// saving the settings for contentZooming and touchaction before activation
				var contentZooming, msTouchAction;

				this.enable = function() {

					if (window.navigator.msPointerEnabled) {
						//  Microsoft pointer model
						target.addEventListener('MSPointerDown', doEvent, false);
						target.addEventListener('MSPointerMove', doEvent, false);
						target.addEventListener('MSPointerUp', doEvent, false);
						target.addEventListener('MSPointerCancel', doEvent, false);

						//  css way to prevent panning in our target area
						if (typeof target.style.msContentZooming !== 'undefined') {
							contentZooming = target.style.msContentZooming;
							target.style.msContentZooming = 'none';
						}

						//  new in Windows Consumer Preview: css way to prevent all built-in touch actions on our target
						//  without this, you cannot touch draw on the element because IE will intercept the touch events
						if (typeof target.style.msTouchAction !== 'undefined') {
							msTouchAction = target.style.msTouchAction;
							target.style.msTouchAction = 'none';
						}
					} else if (target.addEventListener) {
						//  iOS touch model
						target.addEventListener('touchstart', doEvent, false);
						target.addEventListener('touchmove', doEvent, false);
						target.addEventListener('touchend', doEvent, false);
						target.addEventListener('touchcancel', doEvent, false);

						//  mouse model
						target.addEventListener('mousedown', doEvent, false);

						//  mouse model with capture
						//  rejecting gecko because, unlike ie, firefox does not send events to target when the mouse is outside target
						if (target.setCapture && !window.navigator.userAgent.match(/\bGecko\b/)) {
							useSetReleaseCapture = true;

							target.addEventListener('mousemove', doEvent, false);
							target.addEventListener('mouseup', doEvent, false);
						}
					} else if (target.attachEvent && target.setCapture) {
						//  legacy IE mode - mouse with capture
						useSetReleaseCapture = true;
						target.attachEvent('onmousedown', function() {
							doEvent(window.event);
							window.event.returnValue = false;
							return false;
						});
						target.attachEvent('onmousemove', function() {
							doEvent(window.event);
							window.event.returnValue = false;
							return false;
						});
						target.attachEvent('onmouseup', function() {
							doEvent(window.event);
							window.event.returnValue = false;
							return false;
						});
					}
				};

				this.disable = function() {
					if (window.navigator.msPointerEnabled) {
						//  Microsoft pointer model
						target.removeEventListener('MSPointerDown', doEvent, false);
						target.removeEventListener('MSPointerMove', doEvent, false);
						target.removeEventListener('MSPointerUp', doEvent, false);
						target.removeEventListener('MSPointerCancel', doEvent, false);

						//  reset zooming to saved value
						if (contentZooming) {
							target.style.msContentZooming = contentZooming;
						}

						// reset touch action setting
						if (msTouchAction) {
							target.style.msTouchAction = msTouchAction;
						}
					} else if (target.removeEventListener) {
						//  iOS touch model
						target.removeEventListener('touchstart', doEvent, false);
						target.removeEventListener('touchmove', doEvent, false);
						target.removeEventListener('touchend', doEvent, false);
						target.removeEventListener('touchcancel', doEvent, false);

						//  mouse model
						target.removeEventListener('mousedown', doEvent, false);

						//  mouse model with capture
						//  rejecting gecko because, unlike ie, firefox does not send events to target when the mouse is outside target
						if (target.setCapture && !window.navigator.userAgent.match(/\bGecko\b/)) {
							useSetReleaseCapture = true;

							target.removeEventListener('mousemove', doEvent, false);
							target.removeEventListener('mouseup', doEvent, false);
						}
					} else if (target.detachEvent && target.setCapture) {
						//  legacy IE mode - mouse with capture
						useSetReleaseCapture = true;
						target.detachEvent('onmousedown');
						target.detachEvent('onmousemove');
						target.detachEvent('onmouseup');
					}
				};

				return this;
			};
		}])

		.factory('GridsterDraggable', ['$document', '$window', 'GridsterTouch',
			function($document, $window, GridsterTouch) {
				function GridsterDraggable($el, scope, gridster, item, itemOptions) {

					var elmX, elmY, elmW, elmH,

						mouseX = 0,
						mouseY = 0,
						lastMouseX = 0,
						lastMouseY = 0,
						mOffX = 0,
						mOffY = 0,

						minTop = 0,
						minLeft = 0,
						realdocument = $document[0];

					var originalCol, originalRow;
					var inputTags = ['select', 'option', 'input', 'textarea', 'button'];

					function dragStart(event) {
						$el.addClass('gridster-item-moving');
						gridster.movingOrResizingItem = item;

						//Reserve space for whole item Height at the bottom of the grid, so user can drop it there
						gridster.updateHeight(item.getSizeY());
						scope.$apply(function() {
							if (gridster.draggable && gridster.draggable.start) {
								gridster.draggable.start(event, $el, itemOptions, item);
							}
						});
					}

					function drag(event) {
						var oldRow = item.row,
							oldCol = item.col,
							hasCallback = gridster.draggable && gridster.draggable.drag,
							scrollSensitivity = gridster.draggable.scrollSensitivity,
							scrollSpeed = gridster.draggable.scrollSpeed;

						var row = Math.min(gridster.pixelsToRows(elmY, null, true), gridster.maxRows - 1);
						var col = Math.min(gridster.pixelsToColumns(elmX), gridster.columns - 1);

						var itemsInTheWay = gridster.getItems(row, col, item.getSizeX(), item.getSizeY(), item);
						var hasItemsInTheWay = itemsInTheWay.length !== 0;

						if (gridster.swapping === true && hasItemsInTheWay) {
							var boundingBoxItem = gridster.getBoundingBox(itemsInTheWay),
								sameSize = boundingBoxItem.getSizeX() === item.getSizeX() && boundingBoxItem.getSizeY() === item.getSizeY(),
								sameRow = boundingBoxItem.row === oldRow,
								sameCol = boundingBoxItem.col === oldCol,
								samePosition = boundingBoxItem.row === row && boundingBoxItem.col === col,
								inline = sameRow || sameCol;

							if (sameSize && itemsInTheWay.length === 1) {
								if (samePosition) {
									gridster.swapItems(item, itemsInTheWay[0]);
								} else if (inline) {
									return;
								}
							} else if (boundingBoxItem.getSizeX() <= item.getSizeX() && boundingBoxItem.getSizeY() <= item.getSizeY() && inline) {
								var emptyRow = item.row <= row ? item.row : row + item.getSizeY(),
									emptyCol = item.col <= col ? item.col : col + item.getSizeX(),
									rowOffset = emptyRow - boundingBoxItem.row,
									colOffset = emptyCol - boundingBoxItem.col;

								for (var i = 0, l = itemsInTheWay.length; i < l; ++i) {
									var itemInTheWay = itemsInTheWay[i];

									var itemsInFreeSpace = gridster.getItems(
										itemInTheWay.row + rowOffset,
										itemInTheWay.col + colOffset,
										itemInTheWay.getSizeX(),
										itemInTheWay.getSizeY(),
										item
									);

									if (itemsInFreeSpace.length === 0) {
										gridster.putItem(itemInTheWay, itemInTheWay.row + rowOffset, itemInTheWay.col + colOffset);
									}
								}
							}
						}

						if (gridster.pushing !== false || !hasItemsInTheWay) {
							var canPushAway = true;
							for (var $i = 0, $l = itemsInTheWay.length; $i < $l; ++$i) {
								var $itemInTheWay = itemsInTheWay[$i].$element;
								if ($itemInTheWay.hasClass && $itemInTheWay.hasClass('gridster-no-drag')) {
									canPushAway = false;
								}
							}

							if (canPushAway) {
								item.row = row;
								item.col = col;
							}
						}

						if (event.pageY - realdocument.body.scrollTop < scrollSensitivity) {
							realdocument.body.scrollTop = realdocument.body.scrollTop - scrollSpeed;
						} else if ($window.innerHeight - (event.pageY - realdocument.body.scrollTop) < scrollSensitivity) {
							realdocument.body.scrollTop = realdocument.body.scrollTop + scrollSpeed;
						}

						if (event.pageX - realdocument.body.scrollLeft < scrollSensitivity) {
							realdocument.body.scrollLeft = realdocument.body.scrollLeft - scrollSpeed;
						} else if ($window.innerWidth - (event.pageX - realdocument.body.scrollLeft) < scrollSensitivity) {
							realdocument.body.scrollLeft = realdocument.body.scrollLeft + scrollSpeed;
						}

						if (hasCallback || oldRow !== item.row || oldCol !== item.col) {
							scope.$apply(function() {
								if (hasCallback) {
									gridster.draggable.drag(event, $el, itemOptions, item);
								}
							});
						}
					}

					function dragStop(event) {
						$el.removeClass('gridster-item-moving');
						var row = Math.min(gridster.pixelsToRows(elmY, null, true), gridster.maxRows - 1);
						var col = Math.min(gridster.pixelsToColumns(elmX), gridster.columns - 1);

						var itemsInTheWay = gridster.getItems(row, col, item.getSizeX(), item.getSizeY(), item);
						var hasItemsInTheWay = itemsInTheWay.length !== 0;

						if (gridster.pushing !== false || !hasItemsInTheWay) {
							var canPushAway = true;
							for (var $i = 0, $l = itemsInTheWay.length; $i < $l; ++$i) {
								var $itemInTheWay = itemsInTheWay[$i].$element;
								if ($itemInTheWay.hasClass && $itemInTheWay.hasClass('gridster-no-drag')) {
									canPushAway = false;
								}
							}

							if (canPushAway) {
								item.row = row;
								item.col = col;
							}
						}

						gridster.movingOrResizingItem = null;
						// Release reserved space
						gridster.updateHeight();
						item.setPosition(item.row, item.col, true);

						scope.$apply(function() {
							if (gridster.draggable && gridster.draggable.stop) {
								gridster.draggable.stop(event, $el, itemOptions, item);
							}
						});
					}

					function mouseDown(e) {
						if (inputTags.indexOf(e.target.nodeName.toLowerCase()) !== -1) {
							return false;
						}

						var $target = angular.element(e.target);

						// exit, if a resize handle was hit
						if ($target.hasClass('gridster-item-resizable-handler')) {
							return false;
						}

						// exit, if the target has it's own click event
						if ($target.attr('onclick') || $target.attr('ng-click')) {
							return false;
						}

						if ($target.closest) {
							var tmp = $target.closest('.gridster-no-drag');
							if (tmp.length || tmp instanceof Element) {
								return false;
							}
						}

						// apply drag handle filter
						if (gridster.draggable && gridster.draggable.handle) {
							var $dragHandles = angular.element($el[0].querySelectorAll(gridster.draggable.handle));
							var match = false;
							outerloop:
								for (var h = 0, hl = $dragHandles.length; h < hl; ++h) {
									var handle = $dragHandles[h];
									if (handle === e.target) {
										match = true;
										break;
									}
									var target = e.target;
									for (var p = 0; p < 20; ++p) {
										var parent = target.parentNode;
										if (parent === $el[0] || !parent) {
											break;
										}
										if (parent === handle) {
											match = true;
											break outerloop;
										}
										target = parent;
									}
								}
							if (!match) {
								return false;
							}
						}

						switch (e.which) {
							case 1:
								// left mouse button
								break;
							case 2:
							case 3:
								// right or middle mouse button
								return;
						}

						lastMouseX = e.pageX;
						lastMouseY = e.pageY;

						elmX = parseInt($el.css('left'), 10);
						elmY = parseInt($el.css('top'), 10);
						elmW = $el[0].offsetWidth;
						elmH = $el[0].offsetHeight;

						originalCol = item.col;
						originalRow = item.row;

						dragStart(e);

						return true;
					}

					function mouseMove(e) {
						if (!$el.hasClass('gridster-item-moving') || $el.hasClass('gridster-item-resizing')) {
							return false;
						}

						var maxLeft = gridster.curWidth - 1;
						var maxTop = gridster.curRowHeight * gridster.maxRows - 1;

						// Get the current mouse position.
						mouseX = e.pageX;
						mouseY = e.pageY;

						// Get the deltas
						var diffX = mouseX - lastMouseX + mOffX;
						var diffY = mouseY - lastMouseY + mOffY;
						mOffX = mOffY = 0;

						// Update last processed mouse positions.
						lastMouseX = mouseX;
						lastMouseY = mouseY;

						var dX = diffX,
							dY = diffY;
						if (elmX + dX < minLeft) {
							diffX = minLeft - elmX;
							mOffX = dX - diffX;
						} else if (elmX + elmW + dX > maxLeft) {
							diffX = maxLeft - elmX - elmW;
							mOffX = dX - diffX;
						}

						if (elmY + dY < minTop) {
							diffY = minTop - elmY;
							mOffY = dY - diffY;
						} else if (elmY + elmH + dY > maxTop) {
							diffY = maxTop - elmY - elmH;
							mOffY = dY - diffY;
						}
						elmX += diffX;
						elmY += diffY;

						// set new position
						$el.css({
							'top': elmY + 'px',
							'left': elmX + 'px'
						});

						drag(e);

						return true;
					}

					function mouseUp(e) {
						if (!$el.hasClass('gridster-item-moving') || $el.hasClass('gridster-item-resizing')) {
							return false;
						}

						mOffX = mOffY = 0;

						dragStop(e);

						return true;
					}

					var enabled = null;
					var gridsterTouch = null;

					this.enable = function() {
						if (enabled === true) {
							return;
						}
						enabled = true;

						if (gridsterTouch) {
							gridsterTouch.enable();
							return;
						}

						gridsterTouch = new GridsterTouch($el[0], mouseDown, mouseMove, mouseUp);
						gridsterTouch.enable();
					};

					this.disable = function() {
						if (enabled === false) {
							return;
						}

						enabled = false;
						if (gridsterTouch) {
							gridsterTouch.disable();
						}
					};

					this.toggle = function(enabled) {
						if (enabled) {
							this.enable();
						} else {
							this.disable();
						}
					};

					this.destroy = function() {
						this.disable();
					};
				}

				return GridsterDraggable;
			}
		])

		.factory('GridsterResizable', ['GridsterTouch', function(GridsterTouch) {
			function GridsterResizable($el, scope, gridster, item, itemOptions) {

				function ResizeHandle(handleClass) {

					this.hClass = handleClass;
					var hClass = handleClass;

					var elmX, elmY, elmW, elmH,

						lastElmW,
						lastElmH,

						mouseX = 0,
						mouseY = 0,
						lastMouseX = 0,
						lastMouseY = 0,
						mOffX = 0,
						mOffY = 0,

						minTop = 0,
						maxTop = 9999,
						minLeft = 0;

					var getMinHeight = function() {
						return (item.minSizeY ? item.minSizeY : 1) * gridster.curRowHeight - gridster.margins[0];
					};

					var getMinWidth = function() {
						return (item.minSizeX ? item.minSizeX : 1) * gridster.curColWidth - gridster.margins[1];
					};

					var isRestrictedH = function() {
						return item.restrictByContentY && item.$element[0].scrollHeight - lastElmH > 0;
					};

					var isRestrictedW = function() {
						return item.restrictByContentX && item.$element[0].scrollWidth - lastElmW > 0;
					};

					var getElmHByContent = function() {
						return !isRestrictedH() ? elmH : item.$element[0].scrollHeight;
					};

					var getElmWByContent = function() {
						return !isRestrictedW() ? elmW : item.$element[0].scrollWidth;
					};

					var originalWidth, originalHeight;
					var savedDraggable;

					function resizeStart(e) {
						$el.addClass('gridster-item-moving');
						$el.addClass('gridster-item-resizing');

						gridster.movingOrResizingItem = item;

						item.setElementSizeX();
						item.setElementSizeY();
						item.setElementPosition();
						// Reserve space for placeholder slot, so user can move mouse without overlapping item with page content
						gridster.updateHeight(1);

						scope.$apply(function() {
							// callback
							if (gridster.resizable && gridster.resizable.start) {
								gridster.resizable.start(e, $el, itemOptions, item); // options is the item model
							}
						});
					}

					function resize(e) {
						var oldRow = item.row,
							oldCol = item.col,
							oldSizeX = item.sizeX,
							oldSizeY = item.sizeY,
							hasCallback = gridster.resizable && gridster.resizable.resize;

						var col = item.col;
						// only change column if grabbing left edge
						if (['w', 'nw', 'sw'].indexOf(handleClass) !== -1) {
							col = gridster.pixelsToColumns(elmX, false);
						}

						var row = item.row;
						// only change row if grabbing top edge
						if (['n', 'ne', 'nw'].indexOf(handleClass) !== -1) {
							row = gridster.pixelsToRows(elmY, false);
						}

						var sizeX = gridster.pixelsToColumns(getElmWByContent(), true);
						var sizeY = gridster.pixelsToRows(getElmHByContent(), true);

						if (gridster.canItemOccupy(sizeX, sizeY, row, col) && (gridster.pushing !== false || gridster.getItems(row, col, sizeX, sizeY, item).length === 0)) {
							item.row = row;
							item.col = col;
							if (item.sizeX !== 'auto') {
								item.sizeX = sizeX;
							}
							if (item.sizeY !== 'auto') {
								item.sizeY = sizeY;
							}
						}

						var isChanged = item.row !== oldRow || item.col !== oldCol || item.sizeX !== oldSizeX || item.sizeY !== oldSizeY;

						if (hasCallback || isChanged) {
							scope.$apply(function() {
								if (hasCallback) {
									gridster.resizable.resize(e, $el, itemOptions, item); // options is the item model
								}
							});
						}
					}

					function resizeStop(e) {
						$el.removeClass('gridster-item-moving');
						$el.removeClass('gridster-item-resizing');

						gridster.movingOrResizingItem = null;

						item.setPosition(item.row, item.col);
						var changedX = item.setSizeY(item.sizeY);
						var changedY = item.setSizeX(item.sizeX);

						if (changedX || changedY || item.isAutoChangedX() || item.isAutoChangedY()) {
							gridster.moveOverlappingItems(item);
							// Recalculate grid height, based on new sizes
							gridster.layoutChanged();
						} else {
							// Release reserved space
							gridster.updateHeight();
						}

						scope.$apply(function() {
							if (gridster.resizable && gridster.resizable.stop) {
								gridster.resizable.stop(e, $el, itemOptions, item); // options is the item model
							}
						});
					}

					function mouseDown(e) {
						switch (e.which) {
							case 1:
								// left mouse button
								break;
							case 2:
							case 3:
								// right or middle mouse button
								return;
						}

						// save the draggable setting to restore after resize
						savedDraggable = gridster.draggable.enabled;
						if (savedDraggable) {
							gridster.draggable.enabled = false;
							scope.$broadcast('gridster-draggable-changed', gridster);
						}

						// Get the current mouse position.
						lastMouseX = e.pageX;
						lastMouseY = e.pageY;

						// Record current widget dimensions
						elmX = parseInt($el.css('left'), 10);
						elmY = parseInt($el.css('top'), 10);
						elmW = $el[0].offsetWidth;
						elmH = $el[0].offsetHeight;

						originalWidth = item.getSizeX();
						originalHeight = item.getSizeY();

						resizeStart(e);

						return true;
					}

					function mouseMove(e) {
						var maxLeft = gridster.curWidth - 1;

						// Get the current mouse position.
						mouseX = e.pageX;
						mouseY = e.pageY;

						// Get the deltas
						var diffX = mouseX - lastMouseX + mOffX;
						var diffY = mouseY - lastMouseY + mOffY;
						mOffX = mOffY = 0;

						// Update last processed mouse positions.
						lastMouseX = mouseX;
						lastMouseY = mouseY;

						var dY = diffY,
							dX = diffX;

						lastElmW = elmW;
						lastElmH = elmH;

						if (hClass.indexOf('n') >= 0) {
							if (elmH - dY < getMinHeight()) {
								diffY = elmH - getMinHeight();
								mOffY = dY - diffY;
							} else if (elmY + dY < minTop) {
								diffY = minTop - elmY;
								mOffY = dY - diffY;
							}
							if (!isRestrictedH()) {
								elmY += diffY;
							}
							elmH -= diffY;
						}
						if (hClass.indexOf('s') >= 0) {
							if (elmH + dY < getMinHeight()) {
								diffY = getMinHeight() - elmH;
								mOffY = dY - diffY;
							} else if (elmY + elmH + dY > maxTop) {
								diffY = maxTop - elmY - elmH;
								mOffY = dY - diffY;
							}
							elmH += diffY;
						}
						if (hClass.indexOf('w') >= 0) {
							if (elmW - dX < getMinWidth()) {
								diffX = elmW - getMinWidth();
								mOffX = dX - diffX;
							} else if (elmX + dX < minLeft) {
								diffX = minLeft - elmX;
								mOffX = dX - diffX;
							}
							if (!isRestrictedW()) {
								elmX += diffX;
							}
							elmW -= diffX;
						}
						if (hClass.indexOf('e') >= 0) {
							if (elmW + dX < getMinWidth()) {
								diffX = getMinWidth() - elmW;
								mOffX = dX - diffX;
							} else if (elmX + elmW + dX > maxLeft) {
								diffX = maxLeft - elmX - elmW;
								mOffX = dX - diffX;
							}
							elmW += diffX;
						}

						// set new position
						var newStyle = {
							'top': elmY + 'px',
							'left': elmX + 'px'
						};

						if (item.sizeY !== 'auto') {
							newStyle.height = elmH + 'px';
						}
						if (item.sizeX !== 'auto') {
							newStyle.width = elmW + 'px';
						}
						$el.css(newStyle);

						if (isRestrictedW() || isRestrictedH()) {
							if (item.sizeY !== 'auto') {
								newStyle.height = item.$element[0].scrollHeight + 'px';
							}
							if (item.sizeX !== 'auto') {
								newStyle.width = item.$element[0].scrollWidth + 'px';
							}
							$el.css(newStyle);
						}

						$el.css(newStyle);

						resize(e);

						return true;
					}

					function mouseUp(e) {
						// restore draggable setting to its original state
						if (gridster.draggable.enabled !== savedDraggable) {
							gridster.draggable.enabled = savedDraggable;
							scope.$broadcast('gridster-draggable-changed', gridster);
						}

						mOffX = mOffY = 0;

						resizeStop(e);

						return true;
					}

					var $dragHandle = null;
					var unifiedInput;

					this.enable = function() {
						if (!$dragHandle) {
							$dragHandle = angular.element('<div class="gridster-item-resizable-handler handle-' + hClass + '"></div>');
							$el.append($dragHandle);
						}

						unifiedInput = new GridsterTouch($dragHandle[0], mouseDown, mouseMove, mouseUp);
						unifiedInput.enable();
					};

					this.disable = function() {
						if ($dragHandle) {
							$dragHandle.remove();
							$dragHandle = null;
						}

						if (unifiedInput) {
							unifiedInput.disable();
							unifiedInput = undefined;
						}
					};

					this.destroy = function() {
						this.disable();
					};
				}

				var handles = [];
				var handlesOpts = gridster.resizable.handles;
				if (typeof handlesOpts === 'string') {
					handlesOpts = gridster.resizable.handles.split(',');
				}
				var enabled = false;

				for (var c = 0, l = handlesOpts.length; c < l; c++) {
					handles.push(new ResizeHandle(handlesOpts[c]));
				}

				this.enable = function() {
					if (enabled) {
						return;
					}
					var _handles = handles.filter(function(_handle) {
						return !((item.sizeX === 'auto' && ['n', 's'].indexOf(_handle.hClass) === -1) || (item.sizeY === 'auto' && ['e', 'w'].indexOf(_handle.hClass) === -1));
					});
					for (var c = 0, l = _handles.length; c < l; c++) {
						_handles[c].enable();
					}
					enabled = true;
				};

				this.disable = function() {
					if (!enabled) {
						return;
					}
					for (var c = 0, l = handles.length; c < l; c++) {
						handles[c].disable();
					}
					enabled = false;
				};

				this.toggle = function(enabled) {
					if (enabled) {
						this.enable();
					} else {
						this.disable();
					}
				};

				this.destroy = function() {
					for (var c = 0, l = handles.length; c < l; c++) {
						handles[c].destroy();
					}
				};
			}
			return GridsterResizable;
		}])

		.factory('gridsterDebounce', function() {
			return function gridsterDebounce(func, wait, immediate) {
				var timeout;
				return function() {
					var context = this,
						args = arguments;
					var later = function() {
						timeout = null;
						if (!immediate) {
							func.apply(context, args);
						}
					};
					var callNow = immediate && !timeout;
					clearTimeout(timeout);
					timeout = setTimeout(later, wait);
					if (callNow) {
						func.apply(context, args);
					}
				};
			};
		})

		/**
		 * GridsterItem directive
		 * @param $parse
		 * @param GridsterDraggable
		 * @param GridsterResizable
		 * @param gridsterDebounce
		 */
		.directive('gridsterItem', ['$parse', '$timeout', 'GridsterDraggable', 'GridsterResizable', 'gridsterDebounce',
			function($parse, $timeout, GridsterDraggable, GridsterResizable, gridsterDebounce) {
				return {
					scope: true,
					restrict: 'EA',
					controller: 'GridsterItemCtrl',
					controllerAs: 'gridsterItem',
					require: ['^gridster', 'gridsterItem'],
					link: function(scope, $el, attrs, controllers) {
						var optionsKey = attrs.gridsterItem,
							options;

						var gridster = controllers[0],
							item = controllers[1];

						scope.gridster = gridster;

						// bind the item's position properties
						// options can be an object specified by gridster-item="object"
						// or the options can be the element html attributes object
						if (optionsKey) {
							var $optionsGetter = $parse(optionsKey);
							options = $optionsGetter(scope) || {};
							if (!options && $optionsGetter.assign) {
								options = {
									row: item.row,
									col: item.col,
									sizeX: item.getSizeX(),
									sizeY: item.getSizeY(),
									minSizeX: 0,
									minSizeY: 0,
									maxSizeX: null,
									maxSizeY: null
								};
								$optionsGetter.assign(scope, options);
							}
						} else {
							options = attrs;
						}

						item.init($el, gridster);

						$el.addClass('gridster-item');

						function capitalizeFirstLetter(string) {
							return string.charAt(0).toUpperCase() + string.slice(1);
						}

						var aspects = ['minSizeX', 'maxSizeX', 'minSizeY', 'maxSizeY', 'sizeX', 'sizeY', 'row', 'col'],
							$getters = {};

						var expressions = [];
						var aspectFn = function(aspect) {
							var expression;
							if (typeof options[aspect] === 'string' && options[aspect] !== 'auto') {
								// watch the expression in the scope
								expression = options[aspect];
							} else if (typeof options[aspect.toLowerCase()] === 'string' && options[aspect.toLowerCase()] !== 'auto') {
								// watch the expression in the scope
								expression = options[aspect.toLowerCase()];
							} else if (optionsKey) {
								// watch the expression on the options object in the scope
								expression = optionsKey + '.' + aspect;
							} else {
								return;
							}
							expressions.push('"' + aspect + '":' + expression);
							$getters[aspect] = $parse(expression);

							// initial set
							var val = $getters[aspect](scope);
							if (typeof val === 'number' || val === 'auto') {
								item[aspect] = val;
							}
						};

						for (var i = 0, l = aspects.length; i < l; ++i) {
							aspectFn(aspects[i]);
						}

						if (options.restrictByContentX != null) {
							item.restrictByContentX = options.restrictByContentX;
						}
						if (options.restrictByContentY != null) {
							item.restrictByContentY = options.restrictByContentY;
						}
						if (!item.actualOldSizeX) {
							item.actualOldSizeX = item.sizeX;
						}
						if (!item.actualOldSizeY) {
							item.actualOldSizeY = item.sizeY;
						}

						var watchExpressions = '{' + expressions.join(',') + '}';
						// when the value changes externally, update the internal item object
						scope.$watchCollection(watchExpressions, function(newVals, oldVals) {
							for (var aspect in newVals) {
								var newVal = newVals[aspect];
								var oldVal = oldVals[aspect];
								if (oldVal === newVal) {
									continue;
								}
								if (newVal === 'auto') {
									item['actualOld' + capitalizeFirstLetter(aspect)] = item[aspect];
									item[aspect] = newVal;
								} else {
									newVal = parseInt(newVal, 10);
									if (typeof newVal === 'number') {
										item['actualOld' + capitalizeFirstLetter(aspect)] = item[aspect];
										item[aspect] = newVal;
									}
								}
							}
						});

						function positionChanged() {
							// call setPosition so the element and gridster controller are updated
							item.setPosition(item.row, item.col);

							// when internal item position changes, update externally bound values
							if ($getters.row && $getters.row.assign) {
								$getters.row.assign(scope, item.row);
							}
							if ($getters.col && $getters.col.assign) {
								$getters.col.assign(scope, item.col);
							}
						}
						scope.$watch(function() {
							return item.row + ',' + item.col;
						}, positionChanged);

						function sizeChanged() {
							if (item.adjustmentInProgress) {
								return;
							}

							var changedX = item.setSizeX(item.sizeX) || item.isAutoChangedX();
							if (changedX && $getters.sizeX && $getters.sizeX.assign) {
								$getters.sizeX.assign(scope, item.sizeX);
							}

							var changedY = item.setSizeY(item.sizeY) || item.isAutoChangedY();
							if (changedY && $getters.sizeY && $getters.sizeY.assign) {
								$getters.sizeY.assign(scope, item.sizeY);
							}

							if (changedX || changedY) {
								if (gridster.movingOrResizingItem) {
									var prevGridHeight = gridster.gridHeight;
									// Resizing item:
									//  - on increase: add changed amount of slots
									//  - on decrease: render as per content sizes, but reserve 1 placeholder slot so user can move mouse without overlapping item with page content
									gridster.layoutChanged((changedY > 0 ? changedY : 1), function() {
										if (changedY > 0 && gridster.gridHeight === prevGridHeight) {
											// It may happen, that user resize item somewhere in the middle of the grid.
											// In that case we cannot determine if we need placeholder slot prior to calculation is finished.
											// If size didn't change - reserve 1 placeholder slot so user can move mouse without overlapping item with page content
											gridster.layoutChanged(changedY + 1);
										}
									});
								} else {
									// Recalculate grid height, based on new set of items
									gridster.layoutChanged();
								}
								item.gridster.moveOverlappingItems(item);

								// refresh resizable handlers if size became auto or was auto
								if (changedX && (item.sizeX === 'auto' || item.actualOldSizeX === 'auto') ||
									changedY && (item.sizeY === 'auto' || item.actualOldSizeY === 'auto')
								) {
									item.resizable.disable();
									item.resizable.enable();
								}

								scope.$broadcast('gridster-item-resized', item);
							}
						}

						function adjustment() {
							while (item.adjustmentInProgress < 50 && item.getContentSizeX() + item.col > item.gridster.columns) {
								item.adjustmentInProgress++;
								item.setSize('Y', item.sizeY + 1);
							}

							if (item.adjustmentInProgress >= 50) {
								throw new Error('One of gridster widgets causes infinite loop. ' +
									'Stop attempting to fit size for it to prevent browser from crashing.' +
									'Check so initial widget size has meaningful value based on amount of content you have.' +
									'Also it might be related to HTML/CSS that you are using.' +
									'Looks like it cause widget content to grow indefinitely.' +
									'Try to remove `height: 100%` or use `max-height` property.' +
									'This logic runs when there is not enough HORIZONTAL space inside of widget to fit all contents.' +
									'So make sure widget content can fit into browser page or can auto adjust item potision.' +
									'E.g. try to use CSS grid or flexbox.');
							} else {
								item.adjustmentInProgress = 0;
								gridster.layoutChanged();
								item.gridster.moveOverlappingItems(item);
								scope.$broadcast('gridster-item-resized', item);
							}
						}

						scope.$watch(function() {
							// Same code as `item.getSizeX()`, just need to run additional logic there for `adjustment`,
							// so need to duplicate that code there.
							var contentSizeX = item.getContentSizeX();
							var sizeX = item.sizeX === 'auto' || contentSizeX > item.sizeX ? contentSizeX : item.sizeX;

							if ((item.col + sizeX) > item.gridster.columns) {
								sizeX = item.gridster.columns - item.col;

								if (!item.gridster.movingOrResizingItem
									&& !item.gridster.layoutChangedInProgress
									&& !item.adjustmentInProgress
									&& !item.gridster.$resizeInProgress) {
									adjustment();
								}
							}

							return (item.sizeY === 'auto' && item.actualOldSizeY !== 'auto' ? 'auto' : item.getSizeY()) +
								',' + (item.sizeX === 'auto' && item.actualOldSizeX !== 'auto' ? 'auto' : sizeX) +
								',' + item.minSizeX +
								',' + item.maxSizeX +
								',' + item.minSizeY +
								',' + item.maxSizeY;
						}, sizeChanged);

						item.draggable = new GridsterDraggable($el, scope, gridster, item, options);
						item.resizable = new GridsterResizable($el, scope, gridster, item, options);

						var updateResizable = function() {
							item.resizable.toggle(!gridster.isMobile && gridster.resizable && gridster.resizable.enabled);
						};
						updateResizable();

						var updateDraggable = function() {
							item.draggable.toggle(!gridster.isMobile && gridster.draggable && gridster.draggable.enabled);
						};
						updateDraggable();

						scope.$on('gridster-draggable-changed', updateDraggable);
						scope.$on('gridster-resizable-changed', updateResizable);
						scope.$on('gridster-resized', updateResizable);
						scope.$on('gridster-mobile-changed', function() {
							updateResizable();
							updateDraggable();
						});

						function whichTransitionEvent() {
							var el = document.createElement('div');
							var transitions = {
								'transition': 'transitionend',
								'OTransition': 'oTransitionEnd',
								'MozTransition': 'transitionend',
								'WebkitTransition': 'webkitTransitionEnd'
							};
							for (var t in transitions) {
								if (el.style[t] !== undefined) {
									return transitions[t];
								}
							}
						}

						var debouncedTransitionEndPublisher = gridsterDebounce(function() {
							scope.$apply(function() {
								scope.$broadcast('gridster-item-transition-end', item);
							});
						}, 50);

						$el.on(whichTransitionEvent(), debouncedTransitionEndPublisher);

						scope.$broadcast('gridster-item-initialized', item);

						return scope.$on('$destroy', function() {
							try {
								item.resizable.destroy();
								item.draggable.destroy();
							} catch (e) {}

							try {
								gridster.removeItem(item);
							} catch (e) {}

							try {
								item.destroy();
							} catch (e) {}
						});
					}
				};
			}
		])

		.directive('gridsterNoDrag', function() {
			return {
				restrict: 'A',
				link: function(scope, $element) {
					$element.addClass('gridster-no-drag');
				}
			};
		})

	;

}));
